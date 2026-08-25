# ADR 0001 — DigitalRCC LabOps AI architecture

Status: accepted (owner decisions recorded 2026-08-24; §8 lists what is now settled)
Date: 2026-08-24

## 1. Context

DigitalRCC staff triage cyber-lab incidents by hand today: student email arrives at the
cyberlab mailbox, an operator SSHes into Proxmox, AWX and pfSense, and the fix is
remembered rather than recorded. `crc.ai.tcecure.com` was a first attempt — a Next.js
portal with an AWX tool server and an iframe of the stock OpenHands UI — and it duplicates
identity in a local Postgres, exposes lab-mutating AWX calls behind one static secret,
and its OpenHands half never ran (see the inventory).

Phase 1 of LabOps AI is an internal, owner-only pilot at `labops.drcc.digitalrcc.com` that
investigates tickets read-only and proposes changes for human approval. Only the owner
(Eddie) may start investigations; all other staff are read-only and students are denied.

Naming: new DigitalRCC systems follow `drcc-<purpose>-<number>`, so the agent host is
`drcc-labops-01`. Existing `crc-*` systems keep their names.

## 2. Decision

Four tiers, with OpenHands strictly internal:

```
browser (staff)
  → labops.drcc.digitalrcc.com         DigitalRCC-branded Next.js app, same repo/design system as my.digitalrcc.com,
                                   served from drcc-labops-01 behind the existing lab edge nginx (TLS there)
      → /api/labops/*             AI Gateway (BFF): validates Supabase JWT, authorises role, rate-limits,
                                   redacts, records audit_events, owns all model + infra credentials
          → agent server          OpenHands Agent Server, pinned digest, on drcc-labops-01 (pve2),
                                   bound to localhost behind an internal reverse proxy, mTLS/bearer from the gateway only
              → workspace         one throwaway Docker container per investigation, no host mounts,
                                   no infra credentials, CPU/RAM/time/disk capped, egress allow-listed
```

Authority stays where it already is: Supabase for identity/tickets/run metadata,
Wiki.js for human documentation, GitHub for code and playbooks, AWX for remediation.
OpenHands is an execution engine, never a source of truth.

Repositories (no third repo in Phase 1):

- `tcecure/drcc-lab-companion` — frontend, gateway, Supabase integration, migrations, tests.
- `tcecure/crc-awx-labops` — `platform/labops-ai/` VM, Docker, reverse proxy, TLS, firewall, backup/update/rollback automation and the AWX read-only integration docs.

Neither repo stores secrets: env templates, secret names and placeholders only.

### Why not the alternatives

- *Extend `crc.ai`* — its identity model is a second user directory and its tool server already grants un-gated AWX writes; hardening it costs more than porting the two useful modules.
- *Expose OpenHands directly with SSO in front* — leaks OpenHands branding/API, gives no place to enforce per-role tool allow-lists, redaction or approvals, and puts model credentials in a component that also executes untrusted content.
- *Run the agent on Vercel* — needs long-lived sessions, container execution and lab-network reachability; none are available there.

## 2a. Pinned OpenHands components

| Component | Pin | Why |
|---|---|---|
| Agent Server image | `ghcr.io/openhands/agent-server:1.42.1-python` @ `sha256:141a3628925a18ad55f07a09c0a1e3db9852ab0043458dbe7c8003c92396d143` | SDK 1.42.1 is the version `OpenHands` v1.15.0 pins in `config/defaults.json`; published 2026-08-12, so it has aged past the 7-day supply-chain window. Digest-pinned, never `:latest` |
| Upstream repos | `OpenHands/OpenHands` (MIT), `OpenHands/software-agent-sdk` (MIT) | `openhands-cloud` is commercially restricted and is not used |

Agent-server facts the gateway depends on (SDK 1.42.1):

- Listens on `:8000`; `SESSION_API_KEY` is presented in the `X-Session-API-Key` header on every request (its OpenAPI bearer scheme is a different credential and rejects this key) — the gateway is the only holder.
- `OH_SECRET_KEY` encrypts stored conversation secrets; required for restart persistence.
- REST: `POST /conversations`, `GET /conversations/{id}`, `POST /conversations/{id}/{pause,interrupt,run}`, `POST /conversations/{id}/goal{,/stop,/resume}`, `GET|POST /conversations/{id}/events`, `DELETE /conversations/{id}` — which is exactly the start/pause/cancel/resume surface the UI needs.
- Events stream over `WebSocket /conversations/{id}/events/socket`; the server can also push to a gateway **webhook**, which is how run events get persisted durably.
- `DO_NOT_TRACK=1` and `OH_TELEMETRY_EXPORTER=none` — no product telemetry leaves the lab.
- CORS is irrelevant: no browser ever reaches it.

## 3. Identity and authorization

Reuse Supabase. `roles` currently holds `student`, `approver`, `admin`; the spec's six
roles map as: `super_admin` (new), `lab_admin` (new), `developer` (new),
`support_analyst` (new), `reviewer` ← existing `approver`, and `student` → **denied**.
Existing `admin` holders are granted `super_admin` in the same migration so no staff
account loses access. The gateway validates the Supabase access token server-side on
every request, resolves roles through `user_roles`, and default-denies when no
authorized staff role is present.

Phase 1 adds an owner gate on top of the role check: starting, resuming or cancelling an
investigation additionally requires the account listed in `LABOPS_OWNER_EMAIL`
(single value, server-side). Everyone else with a staff role gets read-only views, so the
role model is already in place when the pilot opens up. See `permission-matrix.md`.

## 4. Data

New tables (proposed migration, reviewed before it touches production; RLS on every one,
`service_role`-only writes from the gateway, staff read scoped by role):
`ai_runs`, `ai_run_events`, `ai_messages`, `ai_artifacts`, `ai_tool_actions`,
`ai_approval_requests`, `ai_knowledge_proposals`, `ai_model_usage`,
`ai_integration_health`.

Reused as-is: `support_requests` (tickets — an `ai_runs.support_request_id` FK, nothing
more), `audit_events` (staff and approval audit), `integration_events` (outbox),
`lab_progress` / `lab_verifications` / `lab_status_snapshots` (read-only pod context).

## 5. Tooling phases

Phase 1 (read-only): eligible `support_requests`, published Wiki.js pages, selected Git
repos, AWX job status/history/sanitized stdout through `svc-drcc-labops-ai-ro`,
Guacamole health, Proxmox inventory/status, portal logs, allow-listed monitoring
endpoints. Wazuh is **out of scope for Phase 1** — no agent, no account, no forwarding,
not in acceptance criteria.

Tickets: `support_requests` is the only intake (no mailbox monitoring in Phase 1). The
operator picks a request, the gateway copies only the fields needed for triage into the
run, sanitizes and redacts them, links `ai_runs.support_request_id` back to the
authoritative record, and writes status/findings/resolution back to the run — the ticket
itself is only updated through a Phase 2 approved action.

Phase 2 (gated writes, only after Phase 1 sign-off): create a non-protected branch,
commit to it, open a PR, update a ticket, submit a Wiki.js *proposal*, and launch an
allow-listed AWX job — each requiring a recorded human approval.

Never: arbitrary shell on lab systems, Proxmox mutation, pushes to protected branches or
self-merge, unrestricted AWX templates, firewall changes without approval, access to
student credentials or unrelated student records, secrets in prompts/logs/Git.

## 6. Placement and sizing

`drcc-labops-01` goes on **pve2** (~88 GB free RAM, ~1.24 TB free `local-lvm`); pve1 has
52 GB free with 28 GB earmarked for the last seven POD-SRVs. Shape: 8 vCPU / 24 GB RAM /
200 GB disk, Ubuntu 24.04 LTS, Docker Engine, internal reverse proxy, nftables
default-deny inbound, unattended-upgrades, PBS backups of `/etc` and the persistent
agent volume. No Wazuh agent in Phase 1. `crc-ai-ide-01` (VMID 105) is left alone.

Per-run caps: 2 vCPU, 4 GB RAM, 10 GB workspace disk, 20 min wall clock, a per-run token
ceiling, **one active investigation at a time** for the owner-only pilot, workspaces
destroyed on completion, artifacts retained 30 days.

## 7. Delivery

Staging first, on a `staging` hostname, behind explicit approval before production DNS.
Everything lands as PRs; no migration runs unreviewed; every deployment change ships with
rollback steps. `crc.ai.tcecure.com` availability is checked before and after each
deployment.

## 8. Decisions recorded 2026-08-24

| Question | Decision |
|---|---|
| Public hostname | `labops.drcc.digitalrcc.com`; staging validated first, production DNS only after approval (`checkpoint-dns-tls.md`) |
| Host naming | `drcc-<purpose>-<number>`; this VM is `drcc-labops-01` |
| Model provider | OpenAI API. All Bedrock/IAM requirements removed. Model + key are server-side env on `drcc-labops-01` only (`checkpoint-openai-config.md`) |
| Ticket intake | `support_requests` only; no mailbox in Phase 1 |
| Repos | `drcc-lab-companion` (app) + `crc-awx-labops` `platform/labops-ai/` (infra); no third repo |
| Hosting | Frontend + gateway run as one process on `drcc-labops-01` so every credential stays on that host; Vercel hosting stays possible but would split secrets across two environments (`checkpoint-dns-tls.md`) |
| AWX | Owner creates `svc-drcc-labops-ai-ro`; read-only (`checkpoint-awx-readonly-runbook.md`) |
| Wazuh | Out of Phase 1 scope entirely |
| Operators | Owner-only pilot, one active investigation |

Approval checkpoints returned before any production change: DNS/TLS instructions, OpenAI
secret configuration, AWX runbook, proposed migrations + RLS, infrastructure deployment
plan.
