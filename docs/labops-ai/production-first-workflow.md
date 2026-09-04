# LabOps AI change workflow (production-first)

This is the procedure of record for LabOps AI changes, set by the owner on 2026-08-29. It
replaces the "isolated database → staging → production" ordering that the earlier checkpoint
documents assume.

## There is no staging environment

The Supabase project `DRCC-staging` (`cudbheihfdvbetwtcfdi`) is **legacy and unavailable as a
deployment target**. It holds 14 tables — a partial, structure-only copy of the portal made
before the support-ticket work — and it is missing `support_messages`, `support_attachments`,
`integration_events` and `audit_events`, so the ticket conversation, findings-note and broker
paths cannot run there at all. Nothing is deployed against it, and it is not kept in sync.

Do not treat it as a pre-production gate, and do not plan work that depends on "applying X to
staging first". Where earlier documents say that, read this file instead. Production
(`kkacbtkacadgsnbylkti`) is the only live database.

LabOps AI is not mission-critical and is not in active student-facing use, which is what makes
the production-first workflow acceptable here. It is not a general licence to change the
portal in production: the student portal, tracker and `crc.ai` are out of scope.

## The workflow

1. **Validate on a throwaway local Postgres.** `supabase/tests/labops/run.sh` builds a scratch
   database, applies the migrations, runs the behavioural checks and replays the migrations to
   prove idempotency. A migration does not reach production until this passes.
2. **Keep new functionality behind a disabled write switch.** Every write capability is gated
   on a `public.ai_write_switches` row that ships `false`. Shipping the schema and the code is
   not enabling the capability.
3. **Apply additive, reversible changes only.** No dropped, renamed or retyped column; new
   columns nullable or defaulted; no existing policy widened. Every migration carries its own
   `drop`-based rollback script in its apply log.
4. **Verify production read-only.** Structural verification (tables, RLS, policies, grants,
   switch states) is plain `select`. Where a behaviour must be proven against production
   itself, use a transaction that ends in `raise` so every row it wrote is rolled back —
   `supabase/tests/labops/prod_behaviour.sql` is the pattern.
5. **Use clearly identified test records.** End-to-end runs use a designated
   `support_requests` row that is recognisable as a test record, never a real student's
   ticket.
6. **Enable one capability at a time, then switch it off again.** Flip a single switch, run
   its controlled test, record the result, set it back to `false`. `support_notes` is first;
   `github`, `wikijs` and `awx` each need their own implementation, credentials and approval
   checkpoint, and the broker schema existing is not approval for any of them.
7. **Record every change.** Each production change gets an apply log under
   `docs/labops-ai/` (or `platform/labops-ai/docs/phase2/` in `crc-awx-labops` for host
   changes) stating what was applied, how it was verified, what it leaves off, and how to
   roll it back.

## Legacy staging tooling

`supabase/tests/labops/run_staging.sh` and `staging_checks.py` remain in the tree as the record
of how the Phase 1 tables were validated in 2026-08. They **commit** fixture rows, so they must
never be pointed at production, and the project they targeted is no longer maintained. The
production-safe equivalent is `prod_behaviour.sql`.
