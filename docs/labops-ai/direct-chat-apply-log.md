# Direct Chat migration — apply log

`supabase/migrations/PROPOSED_20260901000000_labops_ai_direct_chat.sql` was applied to
**DRCC production** (`kkacbtkacadgsnbylkti`) on 2026-08-31 on the owner's instruction. The
`PROPOSED_` prefix is kept for the same reason as the rest of the LabOps AI series
(`docs/labops-ai/phase2-apply-log.md`): production is deliberately ahead of the repository's
migration history, and the prefix stops a runner replaying these files out of band. Every
statement is `if not exists` / `duplicate_object`-guarded, so a replay is a no-op.

There is still no staging project — see `docs/labops-ai/production-first-workflow.md`. The
`DRCC-staging` reference is legacy and is not a deployment target.

## What it changes

A run is the conversation thread whether the operator started it from a ticket or typed a
question into Direct Chat, so nothing new stores messages: the transcript stays in
`ai_messages` and the timeline in `ai_run_events`. The whole schema change is the
discriminator plus the constraint that stops the two shapes blurring:

- `ai_runs.support_request_id` is now nullable.
- `ai_runs.source text not null default 'support_request'`, checked against
  `('support_request', 'direct')` — every run that already existed is therefore a ticket
  investigation, with no backfill statement to get wrong.
- `ai_runs_source_target_check`: `support_request` requires the ticket id, `direct` requires
  its absence. A direct question can neither invent a ticket nor inherit a stale one.
- `ai_runs_source_created_idx (source, created_at desc)` — how the history sidebar reads.

No policy is widened, no grant is added, no write switch is touched.

## Validated before the apply

`supabase/tests/labops/run.sh` (throwaway local Postgres, `MIGRATIONS_DIR` pointed at this
repo) applies Phase 1, Phase 2 and this migration, runs
`supabase/tests/labops/92_direct_chat_checks.sql`, then replays all four migrations to prove
idempotency. It asserts the constraints above, that deleting a run takes its transcript with
it, that the history index exists, and that `anon`/`authenticated` still hold no privilege on
`ai_runs`. `ALL CHECKS PASSED`.

## State after the apply

```
support_request_nullable  YES
source_default            'support_request'::text
constraints               2   (ai_runs_source_check, ai_runs_source_target_check)
history_index             1   (ai_runs_source_created_idx)
runs_total                1   all source = support_request
switches_enabled          0
anon SELECT on ai_runs    false
authenticated INSERT      false
```

Behaviour was then exercised against production itself inside one transaction ending in
`raise`, so every row it wrote rolled back (`ai_runs` still holds the single pre-existing
row):

```
PASS ticket run requires its ticket
PASS direct run cannot claim a ticket
PASS only support_request and direct exist
PASS direct run needs no ticket
PASS transcript hangs off the run
```

## Rollback

Additive and reversible. The only destructive part is the column, so drop the constraints
first if any direct run exists — dropping the column drops its constraints with it, but a
`direct` run left behind would become an unmarked ticket run with no ticket, which the
restored `not null` would then reject:

```sql
delete from public.ai_runs where source = 'direct';   -- transcripts cascade
drop index if exists public.ai_runs_source_created_idx;
alter table public.ai_runs drop constraint if exists ai_runs_source_target_check;
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs drop column if exists source;
alter table public.ai_runs alter column support_request_id set not null;
```

Rolling the application back without rolling the schema back is safe and is the preferred
order: the Phase 2 release ignores `source` entirely, and the default keeps every run it
creates a valid ticket investigation.
