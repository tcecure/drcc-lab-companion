-- Community Impact: Moodle-derived learner, course, enrollment and sync state.
--
-- Everything here is additive. Moodle stays authoritative for learners,
-- courses, enrollment and completion; Supabase stays authoritative for portal
-- accounts. The tables below are a read-only projection of Moodle that the
-- portal renders from, written exclusively by the service role during a sync.
-- The existing public.moodle_courses / public.moodle_enrollments tables belong
-- to the (portal account centric) enrollment workflow and are left untouched.

create table if not exists public.moodle_catalog_courses (
  id uuid primary key default gen_random_uuid(),
  moodle_course_id bigint not null unique,
  full_name text not null,
  short_name text not null default '',
  category_name text,
  visible boolean not null default true,
  start_date timestamptz,
  end_date timestamptz,
  tracked boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.moodle_catalog_courses is
  'Tracked DigitalRCC courses as reported by Moodle. Renames update in place so a course is never duplicated.';

create index if not exists moodle_catalog_courses_tracked_idx
  on public.moodle_catalog_courses (tracked, visible);

create table if not exists public.moodle_learners (
  id uuid primary key default gen_random_uuid(),
  moodle_user_id bigint not null unique,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  username text,
  profile_id uuid references public.profiles (id) on delete set null,
  match_status text not null default 'unmatched'
    check (match_status in ('matched', 'unmatched', 'conflict')),
  match_note text,
  is_excluded boolean not null default false,
  exclusion_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.moodle_learners is
  'One row per immutable Moodle user id observed with a student role in a tracked course. Never creates portal accounts.';

create index if not exists moodle_learners_last_name_idx
  on public.moodle_learners (lower(last_name), lower(first_name), moodle_user_id);

create index if not exists moodle_learners_email_idx
  on public.moodle_learners (lower(email));

create index if not exists moodle_learners_profile_idx
  on public.moodle_learners (profile_id)
  where profile_id is not null;

create index if not exists moodle_learners_match_status_idx
  on public.moodle_learners (match_status);

create table if not exists public.moodle_course_enrollments (
  id uuid primary key default gen_random_uuid(),
  moodle_user_id bigint not null
    references public.moodle_learners (moodle_user_id) on delete cascade,
  moodle_course_id bigint not null
    references public.moodle_catalog_courses (moodle_course_id) on delete cascade,
  role_shortname text not null default 'student',
  enrollment_status text not null default 'active'
    check (enrollment_status in ('active', 'suspended', 'inactive')),
  completion_state text not null default 'unknown'
    check (completion_state in ('complete', 'incomplete', 'unknown')),
  completed_at timestamptz,
  progress_percentage numeric(5, 2)
    check (progress_percentage is null or (progress_percentage >= 0 and progress_percentage <= 100)),
  last_access_at timestamptz,
  first_enrolled_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (moodle_user_id, moodle_course_id)
);

comment on table public.moodle_course_enrollments is
  'Cumulative enrollment history: one row per Moodle user and course, kept after the enrollment ends so all-time totals never shrink.';

create index if not exists moodle_course_enrollments_course_idx
  on public.moodle_course_enrollments (moodle_course_id);

create index if not exists moodle_course_enrollments_active_idx
  on public.moodle_course_enrollments (enrollment_status)
  where enrollment_status = 'active';

create index if not exists moodle_course_enrollments_completion_idx
  on public.moodle_course_enrollments (completion_state);

create index if not exists moodle_course_enrollments_user_idx
  on public.moodle_course_enrollments (moodle_user_id);

create table if not exists public.moodle_progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  moodle_user_id bigint not null,
  moodle_course_id bigint not null,
  observed_at timestamptz not null default now(),
  completion_state text not null
    check (completion_state in ('complete', 'incomplete', 'unknown')),
  progress_percentage numeric(5, 2),
  last_access_at timestamptz,
  sync_run_id uuid
);

create index if not exists moodle_progress_snapshots_user_course_idx
  on public.moodle_progress_snapshots (moodle_user_id, moodle_course_id, observed_at desc);

create table if not exists public.moodle_sync_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('full', 'incremental')),
  trigger_source text not null default 'scheduled'
    check (trigger_source in ('scheduled', 'admin', 'manual')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  courses_seen integer not null default 0,
  learners_seen integer not null default 0,
  enrollments_seen integer not null default 0,
  enrollments_written integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists moodle_sync_runs_started_idx
  on public.moodle_sync_runs (started_at desc);

create index if not exists moodle_sync_runs_status_idx
  on public.moodle_sync_runs (status, started_at desc);

-- Admin predicate, mirroring public.support_user_is_admin().
create or replace function public.moodle_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles user_role
    join public.roles role on role.id = user_role.role_id
    where user_role.user_id = auth.uid()
      and role.role_name = 'admin'
      and (user_role.expires_at is null or user_role.expires_at > now())
  );
$$;

revoke all on function public.moodle_user_is_admin() from public;
grant execute on function public.moodle_user_is_admin() to authenticated;

-- Starts a sync run only when no other run is in flight, so overlapping
-- schedules and a manual "Sync now" can never run concurrently. A run still
-- marked running after the stale window is treated as abandoned.
create or replace function public.moodle_start_sync_run(
  run_mode text,
  run_trigger text,
  stale_after interval default interval '30 minutes'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_run_id uuid;
begin
  update public.moodle_sync_runs
  set
    status = 'failed',
    finished_at = now(),
    error_message = coalesce(error_message, 'Abandoned: no completion recorded before the stale window elapsed.')
  where status = 'running'
    and started_at < now() - stale_after;

  insert into public.moodle_sync_runs (mode, trigger_source)
  select run_mode, run_trigger
  where not exists (
    select 1 from public.moodle_sync_runs where status = 'running'
  )
  returning id into new_run_id;

  return new_run_id;
end;
$$;

revoke all on function public.moodle_start_sync_run(text, text, interval) from public;

-- One row per learner for the admin roster, so filtering, sorting and
-- pagination all happen in Postgres.
drop view if exists public.moodle_roster_entries;

create view public.moodle_roster_entries
with (security_invoker = on) as
select
  learner.moodle_user_id,
  learner.first_name,
  learner.last_name,
  learner.email,
  learner.profile_id,
  learner.match_status,
  learner.last_seen_at,
  lower(learner.last_name) as last_name_sort,
  lower(learner.first_name) as first_name_sort,
  coalesce(enrollment.courses_enrolled, 0) as courses_enrolled,
  coalesce(enrollment.courses_completed, 0) as courses_completed,
  coalesce(enrollment.active_enrollments, 0) as active_enrollments,
  enrollment.last_access_at,
  enrollment.latest_completed_at,
  enrollment.progress_percentage,
  coalesce(enrollment.course_ids, array[]::bigint[]) as course_ids,
  coalesce(enrollment.course_names, array[]::text[]) as course_names,
  coalesce(enrollment.active_course_names, array[]::text[]) as active_course_names
from public.moodle_learners learner
left join lateral (
  select
    count(*)::int as courses_enrolled,
    count(*) filter (where enrollment.completion_state = 'complete')::int as courses_completed,
    count(*) filter (where enrollment.enrollment_status = 'active')::int as active_enrollments,
    max(enrollment.last_access_at) as last_access_at,
    max(enrollment.completed_at) as latest_completed_at,
    round(avg(enrollment.progress_percentage), 1) as progress_percentage,
    array_agg(course.moodle_course_id order by course.full_name) as course_ids,
    array_agg(course.full_name order by course.full_name) as course_names,
    array_remove(
      array_agg(
        case when enrollment.enrollment_status = 'active' then course.full_name end
        order by course.full_name
      ),
      null
    ) as active_course_names
  from public.moodle_course_enrollments enrollment
  join public.moodle_catalog_courses course
    on course.moodle_course_id = enrollment.moodle_course_id
  where enrollment.moodle_user_id = learner.moodle_user_id
    and course.tracked
) enrollment on true
where not learner.is_excluded;

comment on view public.moodle_roster_entries is
  'Admin-only Moodle roster. security_invoker keeps the underlying row level security in force.';

-- The four Community Impact aggregates, defined once in SQL.
create or replace function public.moodle_impact_metrics()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with tracked as (
    select enrollment.*, course.visible, course.start_date, course.end_date
    from public.moodle_course_enrollments enrollment
    join public.moodle_catalog_courses course
      on course.moodle_course_id = enrollment.moodle_course_id
    join public.moodle_learners learner
      on learner.moodle_user_id = enrollment.moodle_user_id
    where course.tracked
      and not learner.is_excluded
  )
  select json_build_object(
    'studentsEnrolledAllTime', (select count(distinct moodle_user_id) from tracked),
    'currentlyTakingCourses', (
      select count(distinct moodle_user_id)
      from tracked
      where enrollment_status = 'active'
        and completion_state <> 'complete'
        and visible
        and (start_date is null or start_date <= now())
        and (end_date is null or end_date > now())
    ),
    'totalCourseEnrollments', (select count(*) from tracked),
    'completedCourseEnrollments', (
      select count(*) from tracked where completion_state = 'complete'
    ),
    'eligibleCourseEnrollments', (
      select count(*) from tracked where completion_state in ('complete', 'incomplete')
    ),
    'earliestObservedAt', (
      select min(least(first_enrolled_at, first_seen_at)) from tracked
    ),
    'trackedCourses', (
      select count(*) from public.moodle_catalog_courses where tracked
    ),
    'matchedLearners', (
      select count(*) from public.moodle_learners
      where not is_excluded and match_status = 'matched'
    ),
    'unmatchedLearners', (
      select count(*) from public.moodle_learners
      where not is_excluded and match_status = 'unmatched'
    ),
    'conflictLearners', (
      select count(*) from public.moodle_learners
      where not is_excluded and match_status = 'conflict'
    ),
    'lastSuccessfulSyncAt', (
      select max(finished_at) from public.moodle_sync_runs where status = 'succeeded'
    ),
    'lastFailedSyncAt', (
      select max(finished_at) from public.moodle_sync_runs where status = 'failed'
    )
  );
$$;

revoke all on function public.moodle_impact_metrics() from public;
grant execute on function public.moodle_impact_metrics() to authenticated;

alter table public.moodle_catalog_courses enable row level security;
alter table public.moodle_learners enable row level security;
alter table public.moodle_course_enrollments enable row level security;
alter table public.moodle_progress_snapshots enable row level security;
alter table public.moodle_sync_runs enable row level security;

-- Administrators read; nobody else reads. Writes are service-role only, which
-- bypasses row level security, so no write policy is granted to any role.
drop policy if exists moodle_catalog_courses_admin_read on public.moodle_catalog_courses;
create policy moodle_catalog_courses_admin_read
  on public.moodle_catalog_courses
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists moodle_learners_admin_read on public.moodle_learners;
create policy moodle_learners_admin_read
  on public.moodle_learners
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists moodle_course_enrollments_admin_read on public.moodle_course_enrollments;
create policy moodle_course_enrollments_admin_read
  on public.moodle_course_enrollments
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists moodle_progress_snapshots_admin_read on public.moodle_progress_snapshots;
create policy moodle_progress_snapshots_admin_read
  on public.moodle_progress_snapshots
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

drop policy if exists moodle_sync_runs_admin_read on public.moodle_sync_runs;
create policy moodle_sync_runs_admin_read
  on public.moodle_sync_runs
  for select
  to authenticated
  using ((select public.moodle_user_is_admin()));

revoke all on public.moodle_catalog_courses from anon;
revoke all on public.moodle_learners from anon;
revoke all on public.moodle_course_enrollments from anon;
revoke all on public.moodle_progress_snapshots from anon;
revoke all on public.moodle_sync_runs from anon;
revoke all on public.moodle_roster_entries from anon;

grant select on public.moodle_roster_entries to authenticated;
grant select on public.moodle_catalog_courses to authenticated;
grant select on public.moodle_learners to authenticated;
grant select on public.moodle_course_enrollments to authenticated;
grant select on public.moodle_progress_snapshots to authenticated;
grant select on public.moodle_sync_runs to authenticated;
