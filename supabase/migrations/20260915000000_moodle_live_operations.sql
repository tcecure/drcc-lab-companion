-- Live Operations: real Moodle activity events, Guacamole session state and
-- connector health for the admin-only operational view.
--
-- Everything here is additive. Moodle and Guacamole stay authoritative; these
-- tables are a projection written exclusively by the service role during a
-- collection run. The donor-facing Impact view keeps reading the existing
-- aggregate function and never touches anything below.

-- One row per Moodle standard log event we have ingested. The Moodle log id is
-- the dedupe key, so re-running a collection cannot double count activity.
create table if not exists public.moodle_activity_events (
  id uuid primary key default gen_random_uuid(),
  moodle_log_id bigint not null unique,
  moodle_user_id bigint not null,
  event_name text not null,
  component text not null default '',
  action text not null default '',
  target text not null default '',
  course_id bigint,
  origin text not null default '',
  source_ip text,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

comment on table public.moodle_activity_events is
  'Actual Moodle activity events (standard log store) behind the Live Operations activity windows. Never used by the donor-facing Impact view.';

create index if not exists moodle_activity_events_user_time_idx
  on public.moodle_activity_events (moodle_user_id, occurred_at desc);

create index if not exists moodle_activity_events_time_idx
  on public.moodle_activity_events (occurred_at desc);

create index if not exists moodle_activity_events_course_idx
  on public.moodle_activity_events (course_id, occurred_at desc);

-- Failed Moodle logins. The attempted username is kept because Moodle records
-- no user id when the account does not exist.
create table if not exists public.moodle_login_failures (
  id uuid primary key default gen_random_uuid(),
  moodle_log_id bigint not null unique,
  moodle_user_id bigint,
  attempted_username text not null default '',
  reason text not null default '',
  source_ip text,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create index if not exists moodle_login_failures_user_time_idx
  on public.moodle_login_failures (moodle_user_id, occurred_at desc);

create index if not exists moodle_login_failures_username_idx
  on public.moodle_login_failures (lower(attempted_username), occurred_at desc);

-- Guacamole session rows, pushed in by the server-side collector that reads the
-- Guacamole database inside the lab network. The portal never holds Guacamole
-- credentials for the database, and an open row is only treated as a live
-- session while it is fresh.
create table if not exists public.guacamole_sessions (
  id uuid primary key default gen_random_uuid(),
  guac_history_id bigint not null unique,
  guac_username text not null,
  guac_user_id bigint,
  connection_name text not null default '',
  remote_host text,
  started_at timestamptz not null,
  ended_at timestamptz,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guacamole_sessions is
  'Guacamole connection history projected from the lab-side collector. ended_at null means the session was still open at collection time.';

create index if not exists guacamole_sessions_username_idx
  on public.guacamole_sessions (lower(guac_username), started_at desc);

create index if not exists guacamole_sessions_open_idx
  on public.guacamole_sessions (started_at desc)
  where ended_at is null;

-- Per-connector health and ingestion cursor. One row per connector name, so a
-- stale or failing connector is visible in the interface instead of silently
-- producing an empty activity list.
create table if not exists public.integration_connector_health (
  connector text primary key,
  status text not null default 'unknown'
    check (status in ('ok', 'degraded', 'failed', 'unknown')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  cursor_value bigint not null default 0,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.integration_connector_health is
  'Health and cursor state for each read-only connector (moodle_activity, moodle_login_failures, guacamole_sessions).';

insert into public.integration_connector_health (connector)
values ('moodle_activity'), ('moodle_login_failures'), ('guacamole_sessions')
on conflict (connector) do nothing;

-- Records a collection attempt. Success advances the cursor and clears the
-- error; a failure keeps the previous cursor and the previous success time so
-- the interface can show how stale the data is.
create or replace function public.integration_connector_record(
  connector_name text,
  succeeded boolean,
  new_cursor bigint default null,
  error_text text default null,
  new_detail jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.integration_connector_health as health (
    connector, status, last_attempt_at, last_success_at, last_error, cursor_value, detail, updated_at
  )
  values (
    connector_name,
    case when succeeded then 'ok' else 'failed' end,
    now(),
    case when succeeded then now() else null end,
    case when succeeded then null else error_text end,
    coalesce(new_cursor, 0),
    coalesce(new_detail, '{}'::jsonb),
    now()
  )
  on conflict (connector) do update
  set
    status = case when succeeded then 'ok' else 'failed' end,
    last_attempt_at = now(),
    last_success_at = case when succeeded then now() else health.last_success_at end,
    last_error = case when succeeded then null else error_text end,
    cursor_value = case
      when succeeded then coalesce(new_cursor, health.cursor_value)
      else health.cursor_value
    end,
    detail = coalesce(new_detail, health.detail),
    updated_at = now();
$$;

revoke all on function public.integration_connector_record(text, boolean, bigint, text, jsonb) from public;

-- Activity events are an operational signal, not a record of account history:
-- keeping 30 days is enough for the widest window plus context in the drawer.
create or replace function public.moodle_prune_activity(retain interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.moodle_activity_events where occurred_at < now() - retain;
  get diagnostics removed = row_count;

  delete from public.moodle_login_failures where occurred_at < now() - retain;
  delete from public.guacamole_sessions
  where ended_at is not null and ended_at < now() - retain;

  return removed;
end;
$$;

revoke all on function public.moodle_prune_activity(interval) from public;

-- One row per learner for the Live Operations table, so every filter, the
-- activity window classification and the sort happen in Postgres.
--
-- Activity status is derived only from real Moodle log events. lastaccess /
-- lastcourseaccess is surfaced separately as last_seen_in_moodle_at and never
-- promotes a learner to an active status.
drop view if exists public.moodle_live_operations_entries;

create view public.moodle_live_operations_entries
with (security_invoker = on) as
select
  learner.moodle_user_id,
  learner.first_name,
  learner.last_name,
  learner.email,
  learner.username as moodle_username,
  learner.profile_id,
  learner.match_status,
  lower(learner.last_name) as last_name_sort,
  lower(learner.first_name) as first_name_sort,
  assignment.cohort_number,
  assignment.seat_number,
  assignment.pod_name,
  assignment.lab_username,
  assignment.status as assignment_status,
  assignment.access_starts_at,
  assignment.access_ends_at,
  case
    when assignment.seat_number is null then null
    else 'POD' || lpad(assignment.seat_number::text, 2, '0') || '-SRV'
  end as session_host,
  coalesce(enrollment.courses_enrolled, 0) as courses_enrolled,
  coalesce(enrollment.courses_completed, 0) as courses_completed,
  coalesce(enrollment.active_enrollments, 0) as active_enrollments,
  enrollment.progress_percentage,
  coalesce(enrollment.course_ids, array[]::bigint[]) as course_ids,
  coalesce(enrollment.course_names, array[]::text[]) as course_names,
  enrollment.last_access_at as last_seen_in_moodle_at,
  activity.last_event_at,
  activity.last_event_name,
  activity.last_source_ip,
  coalesce(activity.events_15m, 0) as events_15m,
  coalesce(activity.events_2h, 0) as events_2h,
  coalesce(activity.events_24h, 0) as events_24h,
  coalesce(activity.events_7d, 0) as events_7d,
  coalesce(activity.distinct_ips_7d, 0) as distinct_ips_7d,
  case
    when activity.last_event_at is null then 'no_recent_activity'
    when activity.last_event_at >= now() - interval '15 minutes' then 'active_now'
    when activity.last_event_at >= now() - interval '2 hours' then 'active_2h'
    when activity.last_event_at >= now() - interval '24 hours' then 'active_24h'
    when activity.last_event_at >= now() - interval '7 days' then 'active_7d'
    else 'no_recent_activity'
  end as activity_status,
  coalesce(guac.open_sessions, 0) as guac_open_sessions,
  coalesce(guac.stale_open_sessions, 0) as guac_stale_open_sessions,
  coalesce(guac.open_connection_names, array[]::text[]) as guac_open_connection_names,
  guac.last_session_started_at as guac_last_session_started_at,
  guac.last_connection_name as guac_last_connection_name,
  guac.last_remote_host as guac_last_remote_host,
  coalesce(failures.failed_logins_7d, 0) as failed_logins_7d,
  failures.last_failed_login_at,
  (
    coalesce(failures.failed_logins_7d, 0) >= 3
    or coalesce(guac.stale_open_sessions, 0) > 0
    or (
      assignment.status in ('notified', 'active')
      and assignment.access_starts_at <= now()
      and assignment.access_ends_at > now()
      and coalesce(activity.events_7d, 0) = 0
    )
  ) as needs_attention
from public.moodle_learners learner
left join lateral (
  select
    seat.cohort_number,
    seat.seat_number,
    seat.pod_name,
    seat.lab_username,
    seat.status,
    seat.access_starts_at,
    seat.access_ends_at
  from public.student_cohort_assignments seat
  where learner.profile_id is not null
    and seat.user_id = learner.profile_id
    and seat.status <> 'cancelled'
  order by seat.cohort_number desc, seat.created_at desc
  limit 1
) assignment on true
left join lateral (
  select
    count(*)::int as courses_enrolled,
    count(*) filter (where course_enrollment.completion_state = 'complete')::int as courses_completed,
    count(*) filter (where course_enrollment.enrollment_status = 'active')::int as active_enrollments,
    max(course_enrollment.last_access_at) as last_access_at,
    round(avg(course_enrollment.progress_percentage), 1) as progress_percentage,
    array_agg(course.moodle_course_id order by course.full_name) as course_ids,
    array_agg(course.full_name order by course.full_name) as course_names
  from public.moodle_course_enrollments course_enrollment
  join public.moodle_catalog_courses course
    on course.moodle_course_id = course_enrollment.moodle_course_id
  where course_enrollment.moodle_user_id = learner.moodle_user_id
    and course.tracked
) enrollment on true
left join lateral (
  select
    max(event.occurred_at) as last_event_at,
    (
      select recent.event_name
      from public.moodle_activity_events recent
      where recent.moodle_user_id = learner.moodle_user_id
      order by recent.occurred_at desc
      limit 1
    ) as last_event_name,
    (
      select recent.source_ip
      from public.moodle_activity_events recent
      where recent.moodle_user_id = learner.moodle_user_id
        and recent.source_ip is not null
      order by recent.occurred_at desc
      limit 1
    ) as last_source_ip,
    count(*) filter (where event.occurred_at >= now() - interval '15 minutes')::int as events_15m,
    count(*) filter (where event.occurred_at >= now() - interval '2 hours')::int as events_2h,
    count(*) filter (where event.occurred_at >= now() - interval '24 hours')::int as events_24h,
    count(*) filter (where event.occurred_at >= now() - interval '7 days')::int as events_7d,
    count(distinct event.source_ip) filter (where event.occurred_at >= now() - interval '7 days')::int as distinct_ips_7d
  from public.moodle_activity_events event
  where event.moodle_user_id = learner.moodle_user_id
) activity on true
left join lateral (
  select
    count(*) filter (
      where session.ended_at is null and session.started_at >= now() - interval '24 hours'
    )::int as open_sessions,
    count(*) filter (
      where session.ended_at is null and session.started_at < now() - interval '24 hours'
    )::int as stale_open_sessions,
    array_remove(
      array_agg(
        case
          when session.ended_at is null and session.started_at >= now() - interval '24 hours'
            then session.connection_name
        end
        order by session.started_at desc
      ),
      null
    ) as open_connection_names,
    max(session.started_at) as last_session_started_at,
    (
      select recent.connection_name
      from public.guacamole_sessions recent
      where lower(recent.guac_username) = lower(assignment.lab_username)
      order by recent.started_at desc
      limit 1
    ) as last_connection_name,
    (
      select recent.remote_host
      from public.guacamole_sessions recent
      where lower(recent.guac_username) = lower(assignment.lab_username)
      order by recent.started_at desc
      limit 1
    ) as last_remote_host
  from public.guacamole_sessions session
  where assignment.lab_username is not null
    and lower(session.guac_username) = lower(assignment.lab_username)
) guac on true
left join lateral (
  select
    count(*)::int as failed_logins_7d,
    max(failure.occurred_at) as last_failed_login_at
  from public.moodle_login_failures failure
  where failure.occurred_at >= now() - interval '7 days'
    and (
      failure.moodle_user_id = learner.moodle_user_id
      or (
        learner.username is not null
        and lower(failure.attempted_username) = lower(learner.username)
      )
    )
) failures on true
where not learner.is_excluded;

comment on view public.moodle_live_operations_entries is
  'Admin-only Live Operations projection: learner, portal seat, pod session host, real Moodle activity windows, Guacamole sessions and security counters. security_invoker keeps row level security in force.';

alter table public.moodle_activity_events enable row level security;
alter table public.moodle_login_failures enable row level security;
alter table public.guacamole_sessions enable row level security;
alter table public.integration_connector_health enable row level security;

-- Administrators read; nobody else reads. Writes are service-role only, which
-- bypasses row level security, so no write policy is granted to any role.
drop policy if exists moodle_activity_events_admin_read on public.moodle_activity_events;
create policy moodle_activity_events_admin_read
  on public.moodle_activity_events
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists moodle_login_failures_admin_read on public.moodle_login_failures;
create policy moodle_login_failures_admin_read
  on public.moodle_login_failures
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists guacamole_sessions_admin_read on public.guacamole_sessions;
create policy guacamole_sessions_admin_read
  on public.guacamole_sessions
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists integration_connector_health_admin_read on public.integration_connector_health;
create policy integration_connector_health_admin_read
  on public.integration_connector_health
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

revoke all on public.moodle_activity_events from anon;
revoke all on public.moodle_login_failures from anon;
revoke all on public.guacamole_sessions from anon;
revoke all on public.integration_connector_health from anon;
revoke all on public.moodle_live_operations_entries from anon;

grant select on public.moodle_activity_events to authenticated;
grant select on public.moodle_login_failures to authenticated;
grant select on public.guacamole_sessions to authenticated;
grant select on public.integration_connector_health to authenticated;
grant select on public.moodle_live_operations_entries to authenticated;
