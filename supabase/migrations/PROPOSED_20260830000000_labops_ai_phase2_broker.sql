-- APPLIED to DRCC production (kkacbtkacadgsnbylkti) on 2026-08-29 with owner approval.
-- The PROPOSED_ prefix stays so a migration runner does not replay it out of band, the same
-- convention the Phase 1 labops_ai files follow. See docs/labops-ai/phase2-apply-log.md and
-- platform/labops-ai/docs/phase2/11-approval-broker.md in crc-awx-labops.
--
-- Phase 2 approval/execution broker storage. Strictly additive:
--   * no column is dropped, renamed or retyped;
--   * every added column is nullable or has a default, so existing rows stay valid;
--   * no existing policy is widened; the new write flags default to "disabled".
--
-- There is no staging deployment, so this was validated against a throwaway local Postgres
-- (supabase/tests/labops/run.sh) and the behavioural checks were then replayed against
-- production inside a transaction that rolls back — see docs/labops-ai/phase2-apply-log.md.

-- ---------------------------------------------------------------------------
-- 1. Approval requests learn about risk, immutability and execution
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.ai_action_risk as enum ('low','medium','high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ai_execution_status as enum (
    'not_started','in_flight','succeeded','failed','abandoned'
  );
exception when duplicate_object then null; end $$;

alter table public.ai_approval_requests
  -- Risk drives who may decide and how long the request lives.
  add column if not exists risk public.ai_action_risk not null default 'high',
  -- Proof that what executes is what was approved: sha256 of the canonical payload,
  -- captured at request time and re-checked immediately before execution.
  add column if not exists payload_digest text,
  -- Deduplicates execution across retries and gateway restarts.
  add column if not exists idempotency_key text,
  add column if not exists execution_status public.ai_execution_status not null
    default 'not_started',
  add column if not exists execution_attempts integer not null default 0,
  add column if not exists executed_at timestamptz,
  -- Identifier returned by the external system (AWX job id, GitHub PR number, Wiki page).
  add column if not exists external_ref text,
  -- Sanitized result only. Never a token, never raw stdout.
  add column if not exists execution_result jsonb,
  add column if not exists failure_reason text;

-- One approval, one execution. The partial unique index lets many rows share a null key.
create unique index if not exists ai_approval_idempotency_idx
  on public.ai_approval_requests (idempotency_key)
  where idempotency_key is not null;

create index if not exists ai_approval_pending_idx
  on public.ai_approval_requests (created_at)
  where status = 'pending';

do $$ begin
  alter table public.ai_approval_requests
    add constraint ai_approval_execution_requires_approval
    check (
      execution_status = 'not_started'
      or (status = 'approved' and decided_by is not null and decided_at is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ai_approval_requests
    add constraint ai_approval_attempts_nonnegative
    check (execution_attempts >= 0);
exception when duplicate_object then null; end $$;

comment on column public.ai_approval_requests.payload_digest is
  'sha256 of the canonical action payload at request time; re-verified before execution so approved parameters cannot change after approval.';
comment on column public.ai_approval_requests.execution_result is
  'Sanitized outcome summary. Credentials and raw command output are redacted before insert.';

-- Expiry is enforced by the broker, but a rejected or expired row must never be able to
-- carry an execution. The check above already prevents it; this trigger prevents an
-- approved row from being re-pointed at a different payload afterwards.
create or replace function public.ai_approval_freeze_after_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' then
    if new.action_kind <> old.action_kind
       or new.action_payload::text <> old.action_payload::text
       or coalesce(new.payload_digest,'') <> coalesce(old.payload_digest,'')
       or coalesce(new.idempotency_key,'') <> coalesce(old.idempotency_key,'') then
      raise exception 'approved action parameters are immutable';
    end if;
  end if;

  if old.status in ('rejected','expired') and new.status <> old.status then
    raise exception 'a rejected or expired approval cannot be revived';
  end if;

  return new;
end;
$$;

drop trigger if exists ai_approval_freeze_after_decision on public.ai_approval_requests;
create trigger ai_approval_freeze_after_decision
  before update on public.ai_approval_requests
  for each row execute function public.ai_approval_freeze_after_decision();

-- ---------------------------------------------------------------------------
-- 2. Write kill switches, disabled by default
-- ---------------------------------------------------------------------------

create table if not exists public.ai_write_switches (
  -- 'global' plus one row per integration: 'awx', 'github', 'wikijs', 'support_notes'.
  scope text primary key,
  -- Default deny: a write path is unavailable until someone deliberately enables it.
  enabled boolean not null default false,
  reason text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.ai_write_switches (scope, reason)
values
  ('global', 'Phase 2: writes stay disabled until isolation and egress tests pass.'),
  ('awx', 'Disabled until svc-drcc-labops-ai execution account exists.'),
  ('github', 'Disabled until the GitHub App is created and scoped.'),
  ('wikijs', 'Disabled until the write token is issued.'),
  ('support_notes', 'Internal findings notes; enable after staging validation.')
on conflict (scope) do nothing;

alter table public.ai_write_switches enable row level security;

drop policy if exists "staff read write switches" on public.ai_write_switches;
create policy "staff read write switches" on public.ai_write_switches
  for select to authenticated using (public.labops_is_staff());

-- ---------------------------------------------------------------------------
-- 3. Per-investigation workspace record (isolation evidence)
-- ---------------------------------------------------------------------------

create table if not exists public.ai_run_workspaces (
  run_id uuid primary key references public.ai_runs (id) on delete cascade,
  container_name text not null,
  image_digest text not null,
  volume_name text not null,
  created_at timestamptz not null default now(),
  destroyed_at timestamptz,
  -- 'destroyed' or 'archived', per the retention decision for that run.
  disposition text,
  constraint ai_run_workspaces_disposition_check
    check (disposition is null or disposition in ('destroyed','archived'))
);

alter table public.ai_run_workspaces enable row level security;

drop policy if exists "staff read run workspaces" on public.ai_run_workspaces;
create policy "staff read run workspaces" on public.ai_run_workspaces
  for select to authenticated using (public.labops_is_staff());

comment on table public.ai_run_workspaces is
  'One sandbox per investigation. Proves which container and volume served a run, and when it was destroyed.';

-- ---------------------------------------------------------------------------
-- 4. Findings notes are internal and idempotent
-- ---------------------------------------------------------------------------

-- The application marks the note with [labops-run:<run id>] and checks before inserting.
-- This index makes a duplicate impossible even if two requests race. It is created only
-- when the ticket conversation exists, which it does in production.
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'support_messages'
  ) then
    create table if not exists public.ai_findings_notes (
      run_id uuid primary key references public.ai_runs (id) on delete cascade,
      support_request_id uuid not null references public.support_requests (id) on delete cascade,
      support_message_id uuid not null references public.support_messages (id) on delete cascade,
      created_at timestamptz not null default now()
    );

    alter table public.ai_findings_notes enable row level security;

    drop policy if exists "staff read findings notes" on public.ai_findings_notes;
    create policy "staff read findings notes" on public.ai_findings_notes
      for select to authenticated using (public.labops_is_staff());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants: reads for staff via RLS, writes only via the service role
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'ai_write_switches', 'ai_run_workspaces', 'ai_findings_notes'
  ] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format(
        'revoke insert, update, delete, truncate, trigger, references on public.%I from authenticated, anon',
        t
      );
      execute format('revoke select on public.%I from anon', t);
    end if;
  end loop;
end $$;

-- Execution history must not be rewritable by a client session.
revoke truncate, trigger, references on public.ai_approval_requests
  from authenticated, anon;
