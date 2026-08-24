# ADR 0001 — DigitalRCC LabOps AI architecture

Status: proposed (needs the decisions in §8 before implementation starts)
Date: 2026-08-24

## 1. Context

DigitalRCC staff triage cyber-lab incidents by hand today: student email arrives at the
cyberlab mailbox, an operator SSHes into Proxmox, AWX and pfSense, and the fix is
remembered rather than recorded. `crc.ai.tcecure.com` was a first attempt — a Next.js
portal with an AWX tool server and an iframe of the stock OpenHands UI — and it duplicates
identity in a local Postgres, exposes lab-mutating AWX calls behind one static secret,
and its OpenHands half never ran (see the inventory).

Phase 1 of LabOps AI is an internal Dev/Admin platform at `my.ai.digitalrcc.com` that
investigates tickets read-only and proposes changes for human approval. Students never
get access.

## 2. Decision

Four tiers, with OpenHands strictly internal:

```
browser (staff)
  → my.ai.digitalrcc.com          DigitalRCC-branded Next.js app (Vercel, same repo/design system as my.digitalrcc.com)
      → /api/labops/*             AI Gateway (BFF): validates Supabase JWT, authorises role, rate-limits,
                                   redacts, records audit_events, owns all model + infra credentials
          → agent server          OpenHands Agent Server, pinned digest, on a dedicated pve2 VM,
                                   bound to localhost behind an internal reverse proxy, mTLS/bearer from the gateway only
              → workspace         one throwaway Docker container per investigation, no host mounts,
                                   no infra credentials, CPU/RAM/time/disk capped, egress allow-listed
```

Authority stays where it already is: Supabase for identity/tickets/run metadata,
Wiki.js for human documentation, GitHub for code and playbooks, AWX for remediation.
OpenHands is an execution engine, never a source of truth.

### Why not the alternatives

- *Extend `crc.ai`* — its identity model is a second user directory and its tool server already grants un-gated AWX writes; hardening it costs more than porting the two useful modules.
- *Expose OpenHands directly with SSO in front* — leaks OpenHands branding/API, gives no place to enforce per-role tool allow-lists, redaction or approvals, and puts model credentials in a component that also executes untrusted content.
- *Run the agent on Vercel* — needs long-lived sessions, container execution and lab-network reachability; none are available there.

## 3. Identity and authorization

Reuse Supabase. `roles` currently holds `student`, `approver`, `admin`; the spec's six
roles map as: `super_admin` (new), `lab_admin` (new), `developer` (new),
`support_analyst` (new), `reviewer` ← existing `approver`, and `student` → **denied**.
Existing `admin` holders are granted `super_admin` in the same migration so no staff
account loses access. The gateway validates the Supabase access token server-side on
every request, resolves roles through `user_roles`, and default-denies when no
authorized staff role is present. See `permission-matrix.md`.

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

Phase 1 (read-only): assigned `support_requests`, published Wiki.js pages, selected Git
repos, AWX job status and sanitized stdout, Wazuh through a restricted service account,
Guacamole health, Proxmox inventory/status, portal logs, allow-listed monitoring
endpoints.

Phase 2 (gated writes, only after Phase 1 sign-off): create a non-protected branch,
commit to it, open a PR, update a ticket, submit a Wiki.js *proposal*, and launch an
allow-listed AWX job — each requiring a recorded human approval.

Never: arbitrary shell on lab systems, Proxmox mutation, pushes to protected branches or
self-merge, unrestricted AWX templates, firewall changes without approval, access to
student credentials or unrelated student records, secrets in prompts/logs/Git.

## 6. Placement and sizing

The agent server VM goes on **pve2** (~88 GB free RAM, ~1.24 TB free `local-lvm`); pve1
has 52 GB free with 28 GB earmarked for the last seven POD-SRVs. Requested shape: 8 vCPU
/ 24–32 GB RAM / 200 GB disk, Ubuntu 24.04 LTS, Docker Engine, internal reverse proxy,
nftables/ufw default-deny inbound, Wazuh agent, unattended-upgrades, PBS backups of
`/etc` and the persistent app volume. `crc-ai-ide-01` (VMID 105) is left alone; its
49 GB reservation for 14 GB of use is the cheapest place to reclaim RAM if needed, but
that is a separate change.

Per-run caps: 2 vCPU, 4 GB RAM, 10 GB workspace disk, 20 min wall clock, max 3
concurrent runs, workspaces destroyed on completion and artifacts retained 30 days.

## 7. Delivery

Staging first, on a `staging` hostname, behind explicit approval before production DNS.
Everything lands as PRs; no migration runs unreviewed; every deployment change ships with
rollback steps. `crc.ai.tcecure.com` availability is checked before and after each
deployment.

## 8. Open decisions (blocking implementation)

1. **Hostname** — confirm `my.ai.digitalrcc.com` (4 labels, needs its own cert, DNS at Namecheap) rather than `ai.digitalrcc.com` / `labops.digitalrcc.com`.
2. **Model provider** — no Bedrock credentials exist yet; Bedrock IAM principal, or another provider?
3. **Ticket intake** — `support_requests` exists but student issues currently arrive by email to the cyberlab mailbox. Do staff file tickets in the portal, or does LabOps AI also ingest that mailbox (later phase)?
4. **Repo layout** — frontend + gateway in `tcecure/drcc-lab-companion` (this repo, shares design system, Supabase and Vercel) with agent-server provisioning in `tcecure/crc-awx-labops`; or a new dedicated repo.
5. **Wazuh + AWX service accounts** — a read-only AWX token and a restricted Wazuh API user are needed; who creates them?
