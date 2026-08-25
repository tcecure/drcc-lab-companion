# LabOps AI threat model (Phase 1)

Trust boundaries, from least to most trusted:

1. **Untrusted content** — student ticket text and attachments, log excerpts, web pages, Git file contents, Wiki page bodies. Anything that reaches the model is untrusted input, never instruction.
2. **Staff browser** — authenticated but subject to role checks and CSRF protection.
3. **Gateway (BFF)** — the only component holding AWX, Proxmox, GitHub and Supabase service credentials, and the only caller of the agent server. The OpenAI key sits one layer deeper, in protected configuration on `drcc-labops-01`, and is never held by the Vercel-hosted app.
4. **Agent server** — executes agent loops; reachable only from the gateway.
5. **Workspace container** — executes tool calls and generated code; no credentials, no host mounts, egress allow-listed.

| # | Threat | Mitigation |
|---|---|---|
| T1 | Student or unauthenticated user reaches the app | Supabase token verified server-side on every request; default-deny unless an authorized staff role exists; `student` explicitly denied; no anonymous route beyond `/login` and the third-party notices page |
| T2 | Direct calls to the OpenHands API bypass the gateway | Agent server bound to loopback behind an internal proxy on the pve2 VM, no public DNS, no port-forward; bearer/mTLS credential known only to the gateway; host firewall default-deny inbound except the gateway's source |
| T3 | Prompt injection from ticket text, logs, Wiki or repo content | Untrusted content is wrapped and labelled as data, never merged into the system prompt; tools are allow-listed per role and per phase so a successful injection still cannot reach a write tool; Phase 2 actions always need an out-of-band human approval; injection attempt heuristics logged |
| T4 | Credential exfiltration via the agent | No credential is mounted into a workspace; the gateway brokers every tool call; egress from workspaces restricted to allow-listed hosts; outbound payloads scanned for secret patterns before leaving the gateway |
| T5 | Secrets leaking into transcripts, artifacts or Git | Redaction pass on all model input/output and on stored artifacts (tokens, keys, passwords, pfSense/AD credentials); pre-commit secret scan on any agent-authored branch; no secret is ever written to `ai_messages` |
| T6 | Agent mutates production lab (Proxmox, pfSense, AD) | No Proxmox write API, no shell on lab hosts, AWX limited to a read-only token in Phase 1 and to an allow-listed template set in Phase 2 with recorded approval |
| T7 | Unreviewed code reaching production | Branch creation restricted to non-protected branches; pushes to `main` blocked by branch protection; no self-merge; PRs require human review |
| T8 | Student PII spreading | Only the fields needed for triage are read; no student credential is ever retrievable; unrelated student records out of scope; artifacts retained 30 days then purged |
| T9 | Resource exhaustion / cost blow-out | Per-run CPU/RAM/disk/wall-clock caps, **one active investigation** in the pilot, per-role rate limits, request timeouts, per-run token ceiling and monthly cost ceiling recorded in `ai_model_usage`; OpenAI timeouts, 429s, provider errors and exhausted budgets fail the run closed with an operator-visible reason rather than retrying unbounded |
| T10 | Malicious attachment | Size limit, MIME allow-list, antivirus scan before the file is visible to a run; attachments stored outside the workspace and mounted read-only per-file |
| T11 | Privilege escalation through approvals | Requester ≠ approver enforced in the database; approval tokens single-use and scoped to one action id; approvals expire |
| T12 | Loss of audit integrity | `audit_events` append-only (no update/delete grant to the gateway role); run timeline immutable once terminal; log shipping to a SIEM is deliberately deferred (Wazuh is out of Phase 1 scope) |
| T13 | Collateral damage to `crc.ai` | New platform on its own VM; `crc-ai-ide-01` untouched; availability of `crc.ai.tcecure.com` checked before and after every deployment |
| T14 | Supply-chain compromise of OpenHands or dependencies | Pinned image digest `agent-server:1.42.1-python@sha256:141a36…` (never `:latest`), images at least 7 days old before adoption, lockfiles, dependency and container scanning in CI, upgrades reviewed rather than automatic |
| T15 | Model provider account abuse | Key stored only on `drcc-labops-01` with `0600` root-owned env file, never in Git/Vercel/Supabase/logs/tickets/workspaces, never returned by a gateway route; provider and model selected by env var behind a provider abstraction so the key can be rotated or the provider swapped without code changes; agent-server telemetry disabled (`DO_NOT_TRACK=1`) |

Residual risks accepted for Phase 1: the model provider sees sanitized ticket and log
content; a compromised gateway is game-over by design (it holds the credentials), so it
runs with least-privilege service accounts and isolated egress, and anomalous tool volume
is visible in `ai_tool_actions`/`audit_events`. Centralised alerting (Wazuh) is a later
phase and is not an acceptance criterion here.
