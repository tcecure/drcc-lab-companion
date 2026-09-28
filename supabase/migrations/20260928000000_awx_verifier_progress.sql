-- The portal's own copy of the AWX verifier results.
--
-- Each verifier playbook grades one control family and publishes the same
-- results twice: as AWX job artifacts, which the training tracker reads, and
-- straight to this application. Until now only the tracker path existed on
-- this side, so every progress page depended on training.digitalrcc.com being
-- reachable. One row per family, overwritten by each run, keeps the last
-- graded state here.
create table if not exists public.awx_verifier_progress (
  family text primary key check (family ~ '^[A-Z]{2}$'),
  verifier_job_id bigint not null default 0,
  verified_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- { "pod01": { "L1.1": { "completed": true, "reason": "..." }, ... }, ... }
  pods jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.awx_verifier_progress is
  'Latest per-family lab results pushed by the AWX verifiers. Written only by the service role through /api/integrations/awx/progress.';

-- Service role only: staff read it through the admin client, and pushes arrive
-- on a secret-authenticated route.
alter table public.awx_verifier_progress enable row level security;

create or replace function public.touch_awx_verifier_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();

  return new;
end;
$$;

drop trigger if exists touch_awx_verifier_progress
  on public.awx_verifier_progress;

create trigger touch_awx_verifier_progress
  before update on public.awx_verifier_progress
  for each row
  execute function public.touch_awx_verifier_progress();
