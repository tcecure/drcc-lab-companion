# Phase 2 broker migration — apply log

`supabase/migrations/PROPOSED_20260830000000_labops_ai_phase2_broker.sql` was applied to
**DRCC production** (`kkacbtkacadgsnbylkti`) on 2026-08-29 on the owner's instruction. The
`PROPOSED_` prefix is retained, matching the Phase 1 `labops_ai` files: production is ahead
of the repository's migration history by design, and the prefix stops a runner replaying
these files out of band. Every statement is `if not exists` / `duplicate_object`-guarded, so
a replay is a no-op either way.

## There is no staging project to stage through

The plan of record was isolated database → staging → production. The owner confirmed there
is no staging environment, so the middle step was replaced by two things that do not need
one:

1. **Isolated Postgres.** `supabase/tests/labops/run.sh` builds a throwaway database, applies
   the Phase 1 and Phase 2 migrations, runs the behavioural checks and then replays all three
   migrations to prove idempotency. Passed before the production apply.
2. **Production behaviour, rolled back.** `supabase/tests/labops/prod_behaviour.sql` exercises
   the invariants against production itself inside a single transaction that ends in `raise`,
   so nothing it writes survives. Results travel back in the exception message because a
   rolled-back `select` cannot return rows.

The pre-existing `run_staging.sh` seeds fixture rows and must therefore never be pointed at
production; `prod_behaviour.sql` is the production-safe substitute.

## What production looked like before

Nine `ai_*` tables, two `ai_*` enums, eleven columns on `ai_approval_requests`, all three
`support_*` tables, and none of `ai_write_switches` / `ai_run_workspaces` /
`ai_findings_notes`.

## What the apply added

- `ai_action_risk`, `ai_execution_status` enums.
- Nine columns on `ai_approval_requests`: `risk`, `payload_digest`, `idempotency_key`,
  `execution_status`, `execution_attempts`, `executed_at`, `external_ref`,
  `execution_result`, `failure_reason`.
- `ai_approval_idempotency_idx`, `ai_approval_pending_idx`.
- Checks `ai_approval_execution_requires_approval`, `ai_approval_attempts_nonnegative`
  (alongside the Phase 1 `ai_approval_no_self_approval`).
- Trigger `ai_approval_freeze_after_decision`.
- Tables `ai_write_switches`, `ai_run_workspaces`, `ai_findings_notes`, each with RLS on and
  a single `select` policy for staff (`labops_is_staff()`), no client write policy anywhere.

## Verification after the apply

Structural, read-only:

- RLS enabled on all three new tables; the only policies are the staff `select` ones.
- `anon` holds no privilege at all on the three tables; `authenticated` holds `select` only.
- `TRUNCATE` / `TRIGGER` / `REFERENCES` are revoked from `anon` and `authenticated` on
  `ai_approval_requests` (Supabase grants those by default on new tables).
- All five write switches (`global`, `awx`, `github`, `wikijs`, `support_notes`) are `false`.

Behavioural, rolled back (`prod_behaviour.sql`):

```
PASS self-approval denied
PASS execution requires approval
PASS approved parameters immutable
PASS rejected approval cannot be revived
PASS idempotency key is unique
PASS every write switch disabled
PASS one workspace per run
```

Post-run counts confirm the rollback: `ai_runs`, `ai_approval_requests`,
`ai_run_workspaces` and `ai_findings_notes` are all still empty.

## What this does *not* turn on

The findings-note path stays inert: it needs both this migration (now applied) and the
`support_notes` switch flipped to `true`, which is a deliberate, separate human action.
`awx`, `github` and `wikijs` likewise stay off, and the credentials they would need do not
exist yet. No production row was created, and no existing table, column or policy was
modified.

## Rollback

```sql
drop table if exists public.ai_findings_notes, public.ai_run_workspaces,
  public.ai_write_switches cascade;
drop trigger if exists ai_approval_freeze_after_decision on public.ai_approval_requests;
drop function if exists public.ai_approval_freeze_after_decision();
alter table public.ai_approval_requests
  drop constraint if exists ai_approval_execution_requires_approval,
  drop constraint if exists ai_approval_attempts_nonnegative,
  drop column if exists risk,
  drop column if exists payload_digest,
  drop column if exists idempotency_key,
  drop column if exists execution_status,
  drop column if exists execution_attempts,
  drop column if exists executed_at,
  drop column if exists external_ref,
  drop column if exists execution_result,
  drop column if exists failure_reason;
drop type if exists public.ai_action_risk, public.ai_execution_status;
```

Nothing pre-existing is touched, so the rollback cannot affect the portal.
