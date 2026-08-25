# DigitalRCC AI Gateway — API surface

The gateway is the only thing a browser talks to. The OpenHands Agent Server listens on
loopback on `drcc-labops-01` and is never proxied, so its URL, its bearer key and the
OpenAI key exist only in `/etc/labops/labops.env` and never appear in a response.

All routes live under `app/api/labops/` and are `force-dynamic`. Authorization is resolved
server-side from the Supabase session on every request; nothing is trusted from the client.

| Route | Method | Capability | Notes |
| --- | --- | --- | --- |
| `/api/labops/health` | GET | `read_investigations` | Agent reachability, model/provider names, limits, month-to-date spend. Records `ai_integration_health`. |
| `/api/labops/support-requests` | GET | `read_investigations` | Eligible Phase 1 intake. Ticket text is shown to staff unsanitized because it is not going to a model. |
| `/api/labops/investigations` | GET | `read_investigations` | History with per-run usage. |
| `/api/labops/investigations` | POST | `start_investigation` | Owner-only. Body `{ supportRequestId }`. |
| `/api/labops/investigations/{id}` | GET | `read_investigations` | Detail: run, the sanitized context that was sent, timeline, transcript, tool actions, approvals. |
| `/api/labops/investigations/{id}` | PATCH | `start_investigation` | Records findings/resolution on the investigation. `support_requests` is never written. |
| `/api/labops/investigations/{id}/cancel` | POST | `cancel_investigation` | Owner-only. |
| `/api/labops/investigations/{id}/activity` | GET | `read_investigations` | SSE relay. |
| `/api/labops/approvals/{id}` | POST | `decide_approval` | Body `{ decision, note? }`. Requester can never decide. |

## Status codes

- `401 unauthenticated` — no Supabase session. Machine-readable JSON, never a redirect
  (the proxy matcher only redirects page paths).
- `403 forbidden` — signed in but not LabOps staff, or not the pilot operator for a
  spending action. Students always land here.
- `409` — a second concurrent investigation, cancelling a terminal run, or deciding an
  approval that is no longer pending.
- `422` — the support request is not eligible for investigation.
- `502` — the private agent server could not be reached; the run is already terminal.
- `503 not_configured` — `/etc/labops/labops.env` is incomplete on the host.

## Orchestration invariants (`lib/labops/runs.ts`)

- Only `buildInvestigationBrief()` output reaches the agent: redacted, PII-minimised to a
  pod label, and wrapped as untrusted evidence. Attachment contents are never forwarded.
- Budgets are checked before start (active runs, monthly spend) and on every status frame
  during the relay (tokens, run cost, wall clock). Breaching one cancels the conversation
  and sets `budget_exhausted` / `timed_out`.
- Any start failure ends the run, so a crashed start cannot hold the single active slot.
- Cancellation marks the run cancelled even when the agent does not confirm the stop.
- `ai_model_usage` is append-only, so the relay records the delta against what is already
  stored rather than the agent's cumulative total.
- A dropped or timed-out relay leaves the run alone (the client reconnects); a rate limit
  or hard failure ends it.

## SSE frames

`event:` is the frame type and `data:` the JSON payload:

- `event` — one normalised, redacted activity event.
- `status` — run status plus cumulative usage.
- `budget` — the run was stopped by a limit, with the reason.
- `error` — relay failure, with `retryable`.
- `end` — final status; the stream closes.
