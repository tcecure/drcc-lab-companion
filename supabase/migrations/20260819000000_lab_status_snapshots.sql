-- Lab health snapshots pushed by the internal Proxmox poller. Vercel cannot
-- reach the Proxmox management interface (and it must not be published on the
-- internet), so the lab posts read-only status here every 30-60 seconds and the
-- portal renders the most recent snapshot.
create table if not exists public.lab_status_snapshots (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  source text not null default 'internal-poller',
  nodes jsonb not null default '[]'::jsonb,
  resources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lab_status_snapshots_checked_at_idx
  on public.lab_status_snapshots (checked_at desc);

-- Service role only: the poller authenticates to the API route with a bearer
-- secret, and the portal reads snapshots through the admin client.
alter table public.lab_status_snapshots enable row level security;

-- Keeps the table bounded without a scheduled job: snapshots arrive constantly
-- and only the newest one is ever rendered.
create or replace function public.prune_lab_status_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.lab_status_snapshots
  where checked_at < now() - interval '2 hours';

  return null;
end;
$$;

drop trigger if exists prune_lab_status_snapshots on public.lab_status_snapshots;

create trigger prune_lab_status_snapshots
  after insert on public.lab_status_snapshots
  for each statement
  execute function public.prune_lab_status_snapshots();
