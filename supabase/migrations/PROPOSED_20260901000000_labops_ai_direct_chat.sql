-- Applied to production DRCC by hand; kept under the PROPOSED_ prefix like the rest of
-- the LabOps AI series so an automated push never replays it. See
-- docs/labops-ai/direct-chat-apply-log.md.
--
-- Direct Chat: an investigation no longer has to come from a ticket. A run is the
-- conversation thread either way — the transcript stays in public.ai_messages and the
-- timeline in public.ai_run_events — so the only schema change is the discriminator and
-- the constraint that keeps the two shapes from blurring into each other.

alter table public.ai_runs
  alter column support_request_id drop not null;

alter table public.ai_runs
  add column if not exists source text not null default 'support_request';

do $$ begin
  alter table public.ai_runs
    add constraint ai_runs_source_check check (source in ('support_request', 'direct'));
exception when duplicate_object then null; end $$;

-- A ticket investigation always names its ticket; a direct conversation never carries a
-- stale or invented one.
do $$ begin
  alter table public.ai_runs
    add constraint ai_runs_source_target_check check (
      (source = 'support_request' and support_request_id is not null)
      or (source = 'direct' and support_request_id is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists ai_runs_source_created_idx
  on public.ai_runs (source, created_at desc);
