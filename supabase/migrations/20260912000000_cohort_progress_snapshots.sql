-- Per-cohort lab progress snapshots.
--
-- The AWX tracker grades live infrastructure state, so it only ever describes
-- the cohort currently sitting in the pods: resetting and reseeding for the
-- next cohort erases the previous cohort's standings. This table keeps a
-- point-in-time copy per cohort so a finished cohort stays readable (and
-- rankable) forever while the active cohort continues to render live.
--
-- One row per cohort. An 'interim' row is refreshed from the tracker on every
-- capture; when the cohort's access window closes the row is frozen as
-- 'final' and never written again.
create table if not exists public.cohort_progress_snapshots (
  cohort_number integer primary key check (cohort_number >= 1),
  status text not null default 'interim'
    check (status in ('interim', 'final')),
  captured_at timestamptz not null default now(),
  finalized_at timestamptz,
  source text not null default 'training_tracker',
  tracker_last_run timestamptz,
  -- { "AC": { "name": "Access Control", "labs": ["L1.1", ...] }, ... }
  courses jsonb not null default '{}'::jsonb,
  -- { "pod01": { "L1.1": { "completed": true, "reason": "..." }, ... }, ... }
  pods jsonb not null default '{}'::jsonb,
  -- Lab ids excluded from scoring because they are not real student work
  -- (e.g. the retired IA M3-L2 domain policy waiver, which read complete on
  -- every pod including unassigned ones).
  waived_labs jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cohort_progress_snapshots is
  'Frozen per-cohort lab results captured from the AWX training tracker. Written only by the service role; the tracker stays authoritative for the active cohort.';

create index if not exists cohort_progress_snapshots_status_idx
  on public.cohort_progress_snapshots (status, cohort_number desc);

-- Service role only: staff read it through the admin client on
-- /admin/progress, and captures arrive on a secret-authenticated route.
alter table public.cohort_progress_snapshots enable row level security;

create or replace function public.touch_cohort_progress_snapshots()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();

  return new;
end;
$$;

drop trigger if exists touch_cohort_progress_snapshots
  on public.cohort_progress_snapshots;

create trigger touch_cohort_progress_snapshots
  before update on public.cohort_progress_snapshots
  for each row
  execute function public.touch_cohort_progress_snapshots();
