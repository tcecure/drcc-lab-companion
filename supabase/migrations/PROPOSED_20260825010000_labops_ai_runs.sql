-- PROPOSED — NOT APPLIED. See docs/labops-ai/checkpoint-migrations-rls.md.
--
-- LabOps AI run storage. Everything an investigation produces lives here; the
-- authoritative ticket stays in public.support_requests and is only referenced.
-- The gateway writes with the service role (bypasses RLS); authenticated staff get
-- read-only policies. No table here ever stores a credential: the gateway redacts
-- before insert and there is a test asserting it.

do $$ begin
  create type public.ai_run_status as enum (
    'queued','running','paused','awaiting_approval','succeeded','failed',
    'cancelled','timed_out','budget_exhausted','rate_limited','provider_error'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ai_approval_status as enum ('pending','approved','rejected','expired');
exception when duplicate_object then null; end $$;

-- One investigation, always tied to the support request that triggered it.
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests (id) on delete restrict,
  requested_by uuid not null references auth.users (id) on delete restrict,
  status public.ai_run_status not null default 'queued',
  title text not null,
  -- Sanitized copy of the ticket fields the agent may see. Never the raw ticket.
  sanitized_context jsonb not null default '{}'::jsonb,
  agent_conversation_id text,
  model text not null,
  provider text not null,
  token_budget integer not null,
  wallclock_limit_seconds integer not null,
  failure_reason text,
  findings text,
  resolution text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_runs_support_request_idx on public.ai_runs (support_request_id);
create index if not exists ai_runs_requested_by_idx on public.ai_runs (requested_by, created_at desc);
-- One active investigation at a time for the whole pilot.
create unique index if not exists ai_runs_single_active_idx
  on public.ai_runs ((status in ('queued','running','paused','awaiting_approval')))
  where status in ('queued','running','paused','awaiting_approval');

-- Agent-server event timeline, append-only, sanitized before insert.
create table if not exists public.ai_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  seq integer not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

-- Human-readable transcript (agent/user messages), redacted.
create table if not exists public.ai_messages (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Files/diffs/logs produced by a run. Bodies live in storage; this is metadata.
create table if not exists public.ai_artifacts (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  name text not null,
  content_type text not null,
  byte_size integer not null check (byte_size >= 0),
  storage_path text not null,
  sha256 text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

-- Every tool call the gateway brokered, including denials. This is the audit of what
-- the agent actually touched.
create table if not exists public.ai_tool_actions (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  tool text not null,
  target text,
  is_write boolean not null default false,
  outcome text not null check (outcome in ('allowed','denied','failed','succeeded')),
  request jsonb not null default '{}'::jsonb,
  response_summary text,
  created_at timestamptz not null default now()
);

create index if not exists ai_tool_actions_run_idx on public.ai_tool_actions (run_id, created_at);

-- Human approval gate for anything that writes (Phase 2 actions).
create table if not exists public.ai_approval_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete restrict,
  action_kind text not null,
  action_payload jsonb not null default '{}'::jsonb,
  status public.ai_approval_status not null default 'pending',
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  -- Four-eyes: an approver can never be the requester.
  constraint ai_approval_no_self_approval check (decided_by is null or decided_by <> requested_by)
);

-- Proposed Wiki.js knowledge, published only after approval.
create table if not exists public.ai_knowledge_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_runs (id) on delete set null,
  title text not null,
  body_markdown text not null,
  target_path text,
  status public.ai_approval_status not null default 'pending',
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- Per-run model spend, so cost is attributable to an investigation and a ticket.
create table if not exists public.ai_model_usage (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_runs (id) on delete cascade,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  cost_usd numeric(10,4) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index if not exists ai_model_usage_created_idx on public.ai_model_usage (created_at desc);

-- Last known state of each dependency, for the dashboard.
create table if not exists public.ai_integration_health (
  integration text primary key,
  status text not null check (status in ('ok','degraded','down','unconfigured')),
  detail text,
  checked_at timestamptz not null default now()
);

-- Keep updated_at honest on ai_runs.
create or replace function public.touch_ai_runs_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_ai_runs_updated_at on public.ai_runs;
create trigger touch_ai_runs_updated_at
  before update on public.ai_runs
  for each row execute function public.touch_ai_runs_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: staff read, service role writes. No authenticated insert/update/delete
-- anywhere, so a stolen anon/user JWT cannot fabricate or alter a run, an
-- approval or an audit row.
-- ---------------------------------------------------------------------------

alter table public.ai_runs               enable row level security;
alter table public.ai_run_events         enable row level security;
alter table public.ai_messages           enable row level security;
alter table public.ai_artifacts          enable row level security;
alter table public.ai_tool_actions       enable row level security;
alter table public.ai_approval_requests  enable row level security;
alter table public.ai_knowledge_proposals enable row level security;
alter table public.ai_model_usage        enable row level security;
alter table public.ai_integration_health enable row level security;

drop policy if exists "staff read runs" on public.ai_runs;
create policy "staff read runs" on public.ai_runs
  for select to authenticated using (public.labops_is_staff());

drop policy if exists "staff read run events" on public.ai_run_events;
create policy "staff read run events" on public.ai_run_events
  for select to authenticated using (
    public.labops_is_staff()
    and exists (select 1 from public.ai_runs r where r.id = run_id)
  );

drop policy if exists "staff read messages" on public.ai_messages;
create policy "staff read messages" on public.ai_messages
  for select to authenticated using (
    public.labops_is_staff()
    and exists (select 1 from public.ai_runs r where r.id = run_id)
  );

drop policy if exists "staff read artifacts" on public.ai_artifacts;
create policy "staff read artifacts" on public.ai_artifacts
  for select to authenticated using (
    public.labops_is_staff() and expires_at > now()
  );

drop policy if exists "staff read tool actions" on public.ai_tool_actions;
create policy "staff read tool actions" on public.ai_tool_actions
  for select to authenticated using (public.labops_is_staff());

drop policy if exists "staff read approvals" on public.ai_approval_requests;
create policy "staff read approvals" on public.ai_approval_requests
  for select to authenticated using (public.labops_is_staff());

drop policy if exists "staff read knowledge proposals" on public.ai_knowledge_proposals;
create policy "staff read knowledge proposals" on public.ai_knowledge_proposals
  for select to authenticated using (public.labops_is_staff());

drop policy if exists "staff read model usage" on public.ai_model_usage;
create policy "staff read model usage" on public.ai_model_usage
  for select to authenticated using (public.labops_is_staff());

drop policy if exists "staff read integration health" on public.ai_integration_health;
create policy "staff read integration health" on public.ai_integration_health
  for select to authenticated using (public.labops_is_staff());

-- Supabase grants full DML on new public tables to anon/authenticated by default;
-- RLS already has no write policy, but remove the grant as well so a write can never
-- depend on a policy being present.
revoke insert, update, delete on
  public.ai_runs, public.ai_run_events, public.ai_messages, public.ai_artifacts,
  public.ai_tool_actions, public.ai_approval_requests, public.ai_knowledge_proposals,
  public.ai_model_usage, public.ai_integration_health
  from authenticated, anon;

-- Defence in depth: even the service role must not rewrite history.
revoke update, delete on public.ai_run_events   from authenticated, anon, service_role;
revoke update, delete on public.ai_tool_actions from authenticated, anon, service_role;
revoke update, delete on public.ai_model_usage  from authenticated, anon, service_role;

comment on table public.ai_runs is
  'One LabOps AI investigation. support_requests remains the authoritative ticket record.';
comment on index public.ai_runs_single_active_idx is
  'Pilot constraint: at most one investigation in a non-terminal state.';
