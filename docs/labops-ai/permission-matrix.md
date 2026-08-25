# LabOps AI permission matrix

Roles come from Supabase `user_roles → roles.role_name`. Anyone with no row in this
table, or holding only `student`, is denied at the gateway before any handler runs.

**Phase 1 pilot overrides this table for one capability.** Starting, resuming or
cancelling an investigation additionally requires being the owner account named in the
server-side `LABOPS_OWNER_EMAIL` (Eddie). Non-owner staff with an authorized role get
read-only views — dashboard, tickets, run timelines, artifacts, audit — and receive a 403
with an explanatory reason on any run-control route. The full matrix below is what the
gateway enforces once the pilot opens up; the owner gate is a single additional check, so
removing it later is a config change, not a rewrite.

| Capability | super_admin | lab_admin | developer | support_analyst | reviewer | student |
|---|---|---|---|---|---|---|
| Sign in to `labops.drcc.digitalrcc.com` | yes | yes | yes | yes | yes | **denied** |
| View dashboard / health / model cost | yes | yes | yes | yes | yes | no |
| Read assigned `support_requests` | all | all | linked to a run | assigned + unassigned | all | no |
| Start an investigation | yes | yes | yes | yes | no | no |
| Pause / cancel / resume own run | yes | yes | yes | yes | no | no |
| … in the Phase 1 pilot | **owner only** | no | no | no | no | no |
| More than one active investigation | no (capped at 1 in the pilot) | no | no | no | no | no |
| Cancel anyone's run | yes | yes | no | no | no | no |
| Read run timeline, sanitized output, artifacts | yes | yes | yes | yes | yes | no |
| Phase 1 read-only tools (Wiki, Git read, AWX status via `svc-drcc-labops-ai-ro`, Proxmox inventory, logs) | yes | yes | yes | yes | via run output only | no |
| Request a Phase 2 write action | yes | yes | yes | yes | no | no |
| **Approve** branch/commit/PR proposals | yes | yes | no (not own) | no | yes | no |
| **Approve** AWX remediation (allow-listed) | yes | yes | no | no | no | no |
| **Approve** knowledge proposal → Wiki.js publish | yes | yes | no | no | yes | no |
| Manage tool allow-lists, limits, model config | yes | no | no | no | no | no |
| Read audit log | yes | yes | own actions | own actions | yes | no |

Rules that hold regardless of role:

- No self-approval: the approver must be a different `auth.uid()` than the requester, enforced in the database and in the gateway.
- Approvals are recorded in `ai_approval_requests` and mirrored to `audit_events` with actor, action, before/after and source IP.
- Model and infrastructure credentials never leave the gateway; no role can read them through the UI or API.
- Every deny is logged (role, route, run) so lockouts are diagnosable without loosening the default-deny.
- The stock OpenHands UI is never exposed to any role; the only interface is the DigitalRCC-branded app, and no role can obtain the agent server's address or bearer key through it.
- Wazuh access appears nowhere in this matrix: it is out of Phase 1 scope.
