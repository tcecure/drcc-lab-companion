# Checkpoint 5 — production / staging schema reconciliation

Read-only comparison of the two Supabase projects, taken before any Phase 2 migration is
written. Nothing was applied to either database to produce this document.

> **Superseded in one respect.** The owner has confirmed there is no staging environment, so
> the "apply to staging first" step below no longer exists. The Phase 2 broker migration was
> validated on an isolated Postgres and applied straight to production; see
> [phase2-apply-log.md](./phase2-apply-log.md).

| Project | Ref | Public tables |
| --- | --- | --- |
| DRCC (production) | `kkacbtkacadgsnbylkti` | 44 |
| DRCC-staging | `cudbheihfdvbetwtcfdi` | 14 |

## 1. Ticket storage is production-only

`public.support_requests` exists in both projects, but the conversation half of the support
workflow exists **only in production**:

- `support_messages`
- `support_attachments`
- `integration_events`
- `audit_events`

Consequences for Phase 2:

- the conversation intake, the internal findings note and the approval broker cannot be
  exercised in staging as it stands. Staging is missing the tables they read and write;
- the repository already contains the migration that creates them,
  `supabase/migrations/20260828000000_support_ticket_portal.sql`. Staging needs that applied
  **before** the Phase 2 staging tests, and that is the only thing staging is missing here —
  no new table has to be invented for it.

## 2. `support_requests` column drift

Columns present in production and absent from staging:

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `requester_name` | text | yes | — |
| `requester_email` | text | yes | — |
| `lab_family` | text | yes | — |
| `pod_name` | text | yes | — |
| `last_message_at` | timestamptz | no | `now()` |

One column differs in nullability:

| Column | Production | Staging |
| --- | --- | --- |
| `user_id` | `uuid` **nullable** | `uuid` **not null** |

Consequences:

- `last_message_at` is what the freshness check compares against, and `pod_name` /
  `lab_family` are what the brief prefers over the assignment lookup. Both are production
  columns today, so the same `20260828000000` migration reconciles staging;
- the nullable `user_id` in production means an email-originated ticket can exist without a
  portal account. LabOps code must not assume a requester profile exists — it already does
  not: nothing in the intake path reads `user_id`, and the brief never carries it;
- **do not** "fix" production `user_id` to not-null. It is nullable deliberately and
  tightening it would break existing rows.

## 3. `ai_*` tables match

All ten Phase 1 tables exist in both projects with identical columns:

`ai_runs`, `ai_run_events`, `ai_messages`, `ai_tool_actions`, `ai_approval_requests`,
`ai_artifacts`, `ai_knowledge_proposals`, `ai_model_usage`, `ai_integration_health`
(plus `lab_assignments`, `profiles`, `roles`, `user_roles` supporting them).

Production constraints Phase 2 code must respect, read from `pg_constraint`:

- `ai_approval_no_self_approval` — `CHECK (decided_by IS NULL OR decided_by <> requested_by)`.
  The database already refuses self-approval; the application check is a second layer, not
  the only one.
- `ai_tool_actions_outcome_check` — `outcome IN ('allowed','denied','failed','succeeded')`.
- `support_messages_author_role_check` — `author_role IN ('requester','staff','system')`.
  The findings note therefore uses `system`; there is no `student` role value.
- `support_messages_internal_staff_only` —
  `CHECK (NOT is_internal OR author_role IN ('staff','system'))`. An internal note can only
  be staff- or system-authored, which is exactly what the findings note writes.
- `support_messages_body_check` — `char_length(body) BETWEEN 1 AND 10000`. The findings note
  clamps its body to 10,000 characters rather than risking a failed insert.

## 4. What the approval broker still needs

`ai_approval_requests` as it exists in both projects records the request and the decision,
but nothing about execution:

```
id, run_id, requested_by, action_kind, action_payload, status,
decided_by, decided_at, decision_note, expires_at, created_at
```

Missing for the Phase 2 broker: risk classification, an idempotency key, execution status,
attempt count, external reference, sanitized result, failure reason, and a hash that proves
the approved parameters were not altered after approval. Those are added additively in
checkpoint 6 (`PROPOSED_20260830000000_labops_ai_phase2_broker.sql`) — no column is dropped,
retyped or renamed, and every addition is nullable or defaulted so existing rows stay valid.

`integration_events` already has everything the broker needs for outbound delivery
(`idempotency_key`, `status`, `attempts`, `available_at`, `claimed_at`, `delivered_at`,
`last_error`), so the broker reuses it rather than adding a queue. It is production-only
today — see section 1.

## 5. Reconciliation order

1. Apply the existing `20260828000000_support_ticket_portal.sql` to **staging** so staging
   matches production's ticket schema. Nothing to apply to production; it is already there.
2. Review the checkpoint 6 proposed migration.
3. Apply checkpoint 6 to an isolated database and run the migration tests.
4. Apply to staging; run the RLS and end-to-end tests there.
5. Only then propose it for production, as a separate approval.
