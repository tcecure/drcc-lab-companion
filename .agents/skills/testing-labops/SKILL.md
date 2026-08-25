---
name: testing-labops
description: How to run and test the DigitalRCC LabOps AI staff console (app/admin/labops, app/api/labops/*) locally against the DRCC-staging Supabase project, including seeding usable auth accounts, exercising the owner-only start path, and checking secret leakage.
---

# Testing the LabOps AI console locally

## Run the app against staging Supabase (never production)

Staging project ref: `cudbheihfdvbetwtcfdi` (has the `ai_*` tables). Production `kkacbtkacadgsnbylkti`
should be treated read-only at most.

Fetch staging keys with the Supabase Management API (needs `SUPABASE_ACCESS_TOKEN`) and start
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
```

Using fake *canary* values instead of real keys is the trick that makes leak checks objective:
scan page HTML and API bodies for the canary strings and for the private URL. Unsetting all
`LABOPS_*` reproduces not-configured mode (`isLabOpsConfigured()` false → 503 `not_configured`
on every gateway route, and the "LabOps AI is not installed on this host" card on the page).

## Getting usable staging logins

Seeded `auth.users` rows in staging may be unusable: `instance_id`, `aud`, `role`, timestamps and
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
time: a release built with a `.env.local` pointing at production will authenticate against the
wrong Supabase project even though `/etc/labops/labops.env` says staging. Symptom: "Invalid login
credentials" for known-good staging accounts. Diagnose by grepping the served bundle for the
project ref (`grep -r <ref> /opt/labops/app/current/.next`) or by scanning `/_next/static/**.js`
over HTTP. The stricter env schema also requires `NEXT_PUBLIC_APP_URL`; if it is missing every
page render throws a ZodError → 500.

Staging passwords may need resetting through the Auth admin API before live login works; the
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
- `SUPABASE_ACCESS_TOKEN` — Supabase Management API token used to read staging API keys and run
  staging SQL. No OpenAI or agent-server credential is needed for these tests; the agent-down path
  is itself the thing under test.
