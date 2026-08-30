---
name: testing-labops
description: How to run and test the DigitalRCC LabOps AI staff console (app/admin/labops, app/api/labops/*), including local runs with canary credentials, what can and cannot be verified against production, exercising the owner-only start path, and checking secret leakage.
---

# Testing the LabOps AI console locally

## There is no staging project

`DRCC-staging` (`cudbheihfdvbetwtcfdi`) is **legacy and unavailable**: nothing is deployed
against it, it is not kept in sync, and it lacks `support_messages` / `support_attachments`, so
the conversation, findings-note and broker paths cannot run there. Do not plan a test around
it. Production is `kkacbtkacadgsnbylkti` and the workflow is production-first — see
`docs/labops-ai/production-first-workflow.md`.

What that means for testing:

- **Reads against production are fine** (structural `select`s, page renders, anonymous status
  codes). Treat production as read-only.
- **Never run `supabase/tests/labops/run_staging.sh` against production**: it commits fixture
  rows. `supabase/tests/labops/prod_behaviour.sql` is the production-safe pattern — one
  transaction that ends in `raise`, so everything it wrote rolls back and results come back in
  the exception message.
- **End-to-end runs use a designated test `support_requests` row**, recognisable as a test
  record, never a real student's ticket.
- A local `next dev` with **canary** credentials is still the right harness for authorization,
  leak and error-path testing, and needs no live database beyond reads.

## Running the app locally

Fetch keys with the Supabase Management API (needs `SUPABASE_ACCESS_TOKEN`) and start
`next dev` with them exported. Put the env in a small launcher script and start it with
`setsid nohup /tmp/start.sh > /tmp/dev.log 2>&1 < /dev/null &` — backgrounding a long inline
`export ... && npx next dev` chain directly from the shell tool tends to die with the tool call.
Only ONE `next dev` can run per repo checkout (`Another next dev server is already running.`),
so `pkill -f "next dev"` before relaunching with different env.

### Configured vs not-configured mode
LabOps is "configured" only when the server-side vars are present. To test the configured console:

```
LABOPS_OWNER_EMAIL=<pilot operator email>
LABOPS_LLM_MODEL=gpt-5-mini
LABOPS_LLM_API_KEY=sk-canary-LLMKEYLEAK-9911        # fake canary, greppable
LABOPS_AGENT_SERVER_API_KEY=canary-AGENTKEYLEAK-7742 # fake canary
LABOPS_AGENT_SERVER_URL=http://127.0.0.1:8123        # nothing listening -> agent down
LABOPS_MODEL_PROXY_TOKEN=canary-PROXYTOKENLEAK-3310  # fake canary; mandatory in per_run mode
```

`lib/labops/config.ts` requires `LABOPS_MODEL_PROXY_TOKEN` whenever
`LABOPS_RUNTIME_MODE=per_run`, and a missing one is indistinguishable from not-configured mode —
the console shows the "not installed" card rather than an error, so set the canary token even
when the runtime itself is deliberately absent.

Using fake *canary* values instead of real keys is the trick that makes leak checks objective:
scan page HTML and API bodies for the canary strings and for the private URL. Unsetting all
`LABOPS_*` reproduces not-configured mode (`isLabOpsConfigured()` false → 503 `not_configured`
on every gateway route, and the "LabOps AI is not installed on this host" card on the page).

## Getting usable logins (applies to any project you seed accounts in)

Hand-seeded `auth.users` rows may be unusable: `instance_id`, `aud`, `role`, timestamps and
password/token metadata can be NULL, which makes the Auth admin API answer `404 user_not_found`
and password login fail. Repair them via the Management API `database/query` endpoint by setting
`instance_id`, `aud='authenticated'`, `role='authenticated'`, `email_confirmed_at`, a bcrypt
`encrypted_password`, and non-null token columns (`confirmation_token` etc. must be `''`, not NULL).
There is no `confirmed_at` writable column — it is generated; don't try to set it.

Useful role split for authorization testing: an owner account whose email == `LABOPS_OWNER_EMAIL`
(admin/super_admin), a staff-but-not-owner account (e.g. `approver`), and a `student` account.

## Watch out: strict UUID validation on the start route

`POST /api/labops/investigations` validates `supportRequestId` with zod `.uuid()`, which in zod v4
enforces the RFC variant nibble. Classic hand-seeded test ids like
`44444444-4444-4444-4444-444444444444` are REJECTED with `400 {"code":"invalid_request"}` and the
UI shows "A supportRequestId is required.", which looks like a product bug but is test-data shape.
Insert a ticket with `gen_random_uuid()` to exercise the real start path. If this ever bites real
data, loosening the schema to a plain UUID regex would be the fix.

## Testing the deployed pilot (drcc-labops-01 behind https://labops.drcc.digitalrcc.com)

The live gateway is a Next.js *standalone* build, so `NEXT_PUBLIC_*` values are inlined at BUILD
time: a release built with a `.env.local` pointing at the wrong project will authenticate against
that project no matter what the host env file says. Symptom: "Invalid login credentials" for
known-good accounts. Diagnose by grepping the served bundle for the
project ref (`grep -r <ref> /opt/labops/app/current/.next`) or by scanning `/_next/static/**.js`
over HTTP. The stricter env schema also requires `NEXT_PUBLIC_APP_URL`; if it is missing every
page render throws a ZodError → 500.

Test passwords may need resetting through the Auth admin API before live login works; the
browser `click`/`type` tool often reports "Browser action failed" on this login form even when the
submission succeeded — always `view` to confirm instead of retrying.

### The agent server hop is a separate failure surface from the provider
`lib/labops/agent.ts` authenticates to the pinned OpenHands agent server with the
`X-Session-API-Key` header (its bearer scheme rejects this credential). Failures observed while
starting an investigation, in order of how far the request got:
- `Agent server returned 401 for /api/conversations` → gateway key ≠ agent `SESSION_API_KEY`.
- `Agent server returned 422 for /api/conversations` → auth is fine but the create-conversation
  payload does not match the pinned agent server's schema (version/contract drift). Read the
  agent service journal on the host for the field-level detail; the gateway deliberately never
  surfaces it.
- A provider/LLM error → the request actually reached the model, which is the only state that
  proves an end-to-end start with a placeholder OpenAI key.
Because a conversation is never created in the 401/422 cases, the `/activity` SSE relay and the
approval-decision path cannot be exercised at all — plan for them to stay untested until a start
reaches the provider. `/api/labops/health` now makes an authenticated call too, so `agentServer:
"ok"` does prove the key works, but it still does NOT prove conversation creation works.

Phase 2 changed this hop: the gateway launches one container per investigation and resolves its
address at run time, so there is no fixed `LABOPS_AGENT_SERVER_URL` on the host and "agent down"
is reproduced locally by pointing at a dead port rather than by stopping a shared service. The
provider key lives only in the model proxy (`/etc/labops/model-proxy.env`).

### Malformed vs unknown path ids
`isUuid()` in `lib/labops/http.ts` guards investigation GET/PATCH, cancel, activity, approvals and
the admin detail page: malformed ids give JSON `404 {"code":"not_found"}` and the admin page gives
Next's 404. Note the two residual quirks worth checking rather than assuming: a well-formed but
unknown id on `.../cancel` answers `404 {"code":"run_not_found"}` (different code string), and
`.../activity` answers `200 text/event-stream` with an `event: error` frame instead of a 404 —
both are by design but easy to misread as regressions.

## Verifying API status codes without a browser session

Anonymous checks are easy with curl (`401 unauthenticated` when configured, `503 not_configured`
when not). For authenticated checks, do NOT curl with copied cookies — instead run a small
`fetch()` from the logged-in page and write the statuses/bodies into a visible `<pre>` overlay you
append to `document.body`. The browser console tool returns only the evaluated value, not logs, so
rendering results into the DOM is what makes them both readable and recordable.

## Devin Secrets Needed
- `SUPABASE_ACCESS_TOKEN` — Supabase Management API token used to read API keys and run SQL
  through `database/query`. No OpenAI or agent-server credential is needed for these tests; the
  agent-down path is itself the thing under test.

## Production host notes

- The served client bundle carries **no** Supabase project ref, so "which project is this
  build against?" cannot be answered over HTTP. Grep the release on the VM instead:
  `ssh labops "grep -rl <ref> /opt/labops/app/current/.next | wc -l"` — the expected ref must
  match and the other must be zero.
- The anonymous surface cannot exercise the authenticated `isUuid()` 404 paths: the auth gate
  runs before the id guard, so every bad id returns 401. Bad-id coverage needs a session.
- `/` returns `302 /labops` at the edge; `/labops` is the branded login page and
  `/admin/labops` 307s there when unauthenticated.

## Not-configured mode: check every route, not just the easy ones

Unsetting every `LABOPS_*` var and restarting `next dev` (config is cached per process) makes most
gateway routes answer `503 {"code":"not_configured"}` and the console render the
"LabOps AI is not installed on this host" card. In a `next dev` process started with no `LABOPS_*`
vars, however, the nested routes
`/api/labops/investigations/<id>/cancel`, `.../findings-note` and `.../activity` have been observed
answering **`404 text/html`** (Next's not-found page) instead of `503` JSON, while the same routes
answer JSON normally in configured mode. This is a `next dev` on-demand compilation artefact, not
an app gap: under `next build --webpack && next start` with no `LABOPS_*` set, all ten gateway
routes — including `.../cancel`, `.../findings-note` and `.../activity` — answer
`503 application/json {"code":"not_configured"}`. Confirm any 404 against a production build
before filing it, and treat the full route matrix as a required assertion rather than
extrapolating from `/api/labops/health`.

## Runtime-unavailable error text is a leak surface

With `LABOPS_RUNTIME_MODE=per_run` and the launcher absent, a start correctly fails closed with
`502 {"code":"agent_unavailable"}`, but check the *message*: the raw spawn error
(`... spawn /opt/labops/.../run-investigation.sh ENOENT`) can travel into the API body, the start
banner in `components/labops/actions.tsx`, the detail page banner, tool-action summaries and the
persisted `ai_runs.failure_reason`, i.e. it becomes durable staff-visible content. Always scan all
five surfaces, not just the HTTP body, for `/opt/labops`, `run-investigation.sh`, `ENOENT` and
`spawn `. Those strings are only acceptable in the server log: `lib/labops/workspace.ts` reports a
fixed message (`The investigation runtime could not be invoked`, or
`Investigation runtime failed to <action>`) and sends the launcher path, its stderr and the spawn
error to `console.error` only, so the detail lives in `journalctl -u labops-gateway`.

## Local fixture passwords

The local Supabase fixtures (`labops-owner@digitalrcc.test`, `labops-staff@digitalrcc.test`,
`labops-student@digitalrcc.test`) are created by an ad-hoc seed script, so their passwords are
easily lost across box restarts. Rather than re-seeding, reset one against the LOCAL stack:
`curl -X PUT -H "apikey: $SR" -H "Authorization: Bearer $SR" -H 'content-type: application/json' \
  -d '{"password":"<new>"}' http://127.0.0.1:54321/auth/v1/admin/users/<user_id>`
(`$SR` = local service-role key). Never do this against production users.

## Owner-vs-non-owner without a second account

To test "staff but not owner" you do not need another login: restart the harness with
`LABOPS_OWNER_EMAIL=nobody-owner@digitalrcc.test` and keep the existing staff session. The intake
row must then read "Operator only" with no Investigate control, GETs stay 200, and
start/cancel/findings-note/PATCH must all return `403 {"code":"forbidden"}`.
