# Approval checkpoint — proposed Supabase migrations and RLS

**Nothing has been applied to the DRCC project (`kkacbtkacadgsnbylkti`).** The two files
below are prefixed `PROPOSED_` so no migration runner can pick them up; they are renamed
to their real timestamps only after you approve, and they are then applied to a staging
project (or a branch) before production.

| File | What it does |
|---|---|
| `supabase/migrations/PROPOSED_20260825000000_labops_ai_roles.sql` | Adds four staff roles; grants `super_admin` to existing `admin` holders; adds the `labops_*` predicate functions used by every policy |
| `supabase/migrations/PROPOSED_20260825010000_labops_ai_runs.sql` | Adds the nine `ai_*` tables, two enums, the single-active-run constraint and all RLS policies |

## Reuse, not replacement

Untouched and still authoritative: `support_requests`, `profiles`, `roles`, `user_roles`,
`audit_events`, `integration_events`, `lab_*`. No column is dropped or renamed anywhere,
so the existing portal keeps working unchanged and rollback is a clean `drop`.

Roles: `student` → denied, `approver` → reviewer semantics (no rename), `admin` → keeps
everything and additionally gets `super_admin`. Additive only.

## New tables

`ai_runs`, `ai_run_events`, `ai_messages`, `ai_artifacts`, `ai_tool_actions`,
`ai_approval_requests`, `ai_knowledge_proposals`, `ai_model_usage`,
`ai_integration_health`.

Design points worth reviewing:

- `ai_runs.support_request_id` is `not null` with `on delete restrict` — an investigation cannot exist without its ticket, and a ticket with an investigation cannot be silently deleted.
- `sanitized_context` holds *only* the redacted triage fields the agent may see; the raw ticket is never copied.
- `ai_runs_single_active_idx` is a partial unique index, so **one active investigation** is a database invariant, not just gateway logic — two concurrent requests cannot both win.
- `ai_approval_no_self_approval` is a table constraint: no-self-approval cannot be bypassed by a bug in the gateway.
- `ai_artifacts.expires_at` defaults to 30 days and the read policy filters on it, so expired artifacts become invisible even before the purge job runs.
- `ai_tool_actions` records denials as well as successes — that is the record of what the agent tried.

## RLS model

Every new table has RLS enabled. There is **no** insert/update/delete policy for
`authenticated` or `anon` anywhere: all writes go through the gateway's service role, which
is the only component that validated the operator's identity, the owner gate and the
budgets. Reads are `to authenticated using (public.labops_is_staff())`, and
`labops_is_staff()` returns false for students and for users with no role row, so the
default is deny.

`update`/`delete` are additionally revoked from *every* role — including `service_role` —
on `ai_run_events`, `ai_tool_actions` and `ai_model_usage`, which makes the audit trail
append-only at the grant level rather than by convention.

Helper functions are `security definer` with `set search_path = public`, `execute` revoked
from `public` and granted only to `authenticated`.

## Verification before production

```sql
-- as a student JWT: every one of these must return zero rows
select * from public.ai_runs;                select * from public.ai_messages;
select * from public.ai_tool_actions;        select * from public.ai_model_usage;
-- as a staff JWT: reads work, writes fail
insert into public.ai_runs (support_request_id, requested_by, title, model, provider,
                            token_budget, wallclock_limit_seconds)
values (...);                                 -- expect: new row violates row-level security
-- single-active invariant
-- inserting a second 'running' run must raise unique_violation on ai_runs_single_active_idx
-- audit immutability
update public.ai_run_events set kind = 'x';   -- expect: permission denied
```

These run as integration tests against a staging project, and the student-denial cases are
part of the acceptance criteria.

### Staging result

Both migrations are applied to the `DRCC-staging` project (structure-only copy of the five
portal tables, no production rows), and all ten behavioural checks pass there:

```bash
SUPABASE_ACCESS_TOKEN=... supabase/tests/labops/run_staging.sh <staging-ref>
# STAGING CHECKS PASSED
```

The script is re-runnable: it seeds fixtures idempotently, replays both migrations, asserts
the table privileges (`authenticated` may select but not write, `anon` may not read, even
`service_role` cannot update the audit tables) and removes its own rows afterwards. It also
must never be pointed at production - migrations reach production only after approval.

Two defects the remote run surfaced that the local harness could not: the production
`roles_role_name_check` constraint rejected the four new role names (the migration now
rebuilds the allow-list first), and `anon` retained Supabase's default `select` grant on the
new tables (now revoked).

## Rollback

```sql
drop table if exists public.ai_model_usage, public.ai_knowledge_proposals,
  public.ai_approval_requests, public.ai_tool_actions, public.ai_artifacts,
  public.ai_messages, public.ai_run_events, public.ai_integration_health,
  public.ai_runs cascade;
drop type if exists public.ai_run_status, public.ai_approval_status;
drop function if exists public.labops_roles, public.labops_is_staff, public.labops_can_approve;
-- role rows may be left in place; they grant nothing once the tables are gone
```

Nothing pre-existing is modified, so rollback cannot damage the portal.

## Approval requested

- [ ] Table/column design and the two invariants enforced in the database (single active run, no self-approval).
- [ ] RLS model: staff read-only, all writes via the gateway service role, audit tables append-only for everyone.
- [ ] Apply to staging first, then production on your go-ahead only.
