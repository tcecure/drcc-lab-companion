# Approval checkpoint — AWX read-only service account runbook (`svc-drcc-labops-ai-ro`)

**Devin has created nothing in AWX.** This is the runbook for you to execute. I will ask
for the token only after you approve this and the integration is ready to test.

Environment verified read-only on 2026-08-24: **AWX 24.6.1** at
`http://192.168.1.103:30080` (NodePort, internal only), single organization `Default`.

| Object type | Present today |
|---|---|
| Inventories | `CRC-LabPods` (4), `CRC-Proxmox` (3), `Proxmox Hosts` (2), `Demo Inventory` (1) |
| Projects | `crc-awx-labops` (10), `CRC-LabOps` (8), `Demo Project` (6) |
| Job templates | 26, including `CRC Auto-Verify (All Labs)` (11), the per-family `Verify …` templates (13, 19, 22, 28, 31), `Generate Completion Certificate` (36), and the `Seed …`/`Reset …`/`Provision …` families |

## 1. Account

| Field | Value |
|---|---|
| Username | `svc-drcc-labops-ai-ro` |
| First / last name | `DigitalRCC LabOps AI` / `Read Only` |
| Email | a monitored address you own (not a student address) |
| User type | **Normal User** — *not* System Administrator, *not* System Auditor |
| Organization | `Default` (the only org) |
| Password | long random value stored in your password manager; the token, not the password, is what LabOps uses |

`System Auditor` is deliberately avoided: it would grant read access to every object in
AWX including credential and user objects. We grant object-level reads instead.

## 2. Team

| Field | Value |
|---|---|
| Team name | `DigitalRCC LabOps AI (read-only)` |
| Organization | `Default` |
| Members | `svc-drcc-labops-ai-ro` only |

Permissions are granted to the **team**, so revoking or re-scoping later is one place.
AWX 24.6.1: Access → Teams → Add, then Team → Access → Add → Users.

## 3. Minimum permissions

Team → Roles → Add, granting exactly:

| Resource | Role | Why |
|---|---|---|
| Inventory `CRC-LabPods` | `Read` | See pod hosts/groups and variables for triage |
| Inventory `CRC-Proxmox` | `Read` | Map a pod to its VMs |
| Project `crc-awx-labops` (10) | `Read` | Playbook/branch metadata and revision |
| Project `CRC-LabOps` (8) | `Read` | Same, legacy project |
| Job templates: `CRC Auto-Verify (All Labs)` (11), `CRC Auto-Verify IA Labs` (16), `Verify CMMC AC Labs` (13), `Verify CMMC SC Labs` (22), `Verify CMMC SI Labs` (19), `Verify - MP Family` (28), `Verify - PE Family` (31), `Generate Completion Certificate` (36) | `Read` | Template metadata, job status/history and sanitized stdout for the verification jobs LabOps reasons about |

Explicitly **not** granted: `Execute` on any template, `Admin`/`Use` on anything,
`Use` on any credential, any role on `Seed …`, `Reset …`, `Provision Pod Member Server`,
`Setup …` or `Auto-Advance Families` templates, and no organization-level role. Without
`Execute` the API returns 403 on every `/launch/`, so a compromised token cannot start,
change or cancel a job, touch inventories/projects/credentials, or alter users and
permissions.

Phase 2 remediation, if it is ever approved, is a *separate* account with `Execute` on a
named allow-list — never an upgrade of this one.

## 4. Token creation

As the `svc-drcc-labops-ai-ro` user (log in as that account so the token is bound to it):

1. AWX UI → user menu → **User Details → Tokens → Add**.
2. Application: **leave blank** (personal access token).
3. Description: `DigitalRCC LabOps AI gateway (read-only)`.
4. Scope: **Read**.
5. Copy the token once — AWX shows it only at creation.

`Scope: Read` is the second, independent guard: even if a role were mis-assigned later,
the token itself cannot perform a write.

Deliver it to me only when I ask, through the session secret mechanism (never in chat, a
ticket, a Git commit or a Wiki page).

## 5. Validation tests

Run these with the new token before handing it over — the last four **must** fail.

```bash
AWX=http://192.168.1.103:30080/api/v2
H="Authorization: Bearer <token>"

# must succeed
curl -sf -H "$H" "$AWX/me/"                                | jq '.results[0].username, .results[0].is_superuser'
curl -sf -H "$H" "$AWX/inventories/4/"                     | jq .name
curl -sf -H "$H" "$AWX/projects/10/"                        | jq '.name,.scm_revision'
curl -sf -H "$H" "$AWX/job_templates/11/"                   | jq '.name,.playbook'
curl -sf -H "$H" "$AWX/job_templates/11/jobs/?page_size=5"  | jq '.results[].status'
curl -sf -H "$H" "$AWX/jobs/?page_size=5"                   | jq '.results[].name'
JOB=$(curl -sf -H "$H" "$AWX/job_templates/11/jobs/?page_size=1" | jq -r '.results[0].id')
curl -sf -H "$H" "$AWX/jobs/$JOB/stdout/?format=txt" | head -5

# must fail (expect 403/405; anything else is a mis-grant — stop and re-check roles)
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "$H" "$AWX/job_templates/11/launch/"
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "$H" "$AWX/job_templates/12/launch/"
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH -H "$H" -H 'Content-Type: application/json' \
     -d '{"description":"nope"}' "$AWX/job_templates/11/"
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$AWX/credentials/"
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "$H" "$AWX/users/"
```

The same assertions run in the gateway's integration test suite, so a future permission
drift fails CI rather than being discovered in production.

## 6. Storage

| Where | How |
|---|---|
| `drcc-labops-01` | `LABOPS_AWX_TOKEN` in `/etc/labops/labops.env`, `root:labops-gateway 0640`, systemd `EnvironmentFile` |
| Anywhere else | Never — not Git, not Vercel, not Supabase, not a workspace container, not a prompt, not a log line |

The gateway is the only caller of AWX; the agent never receives the token and never sees
the AWX URL. Job stdout is redaction-scanned before it can enter a transcript.

## 7. Rotation (quarterly, or immediately on suspicion)

1. Create a second token on the same user (scope `Read`).
2. Update `/etc/labops/labops.env`, `systemctl restart labops-gateway`.
3. Confirm `/api/labops/health` reports AWX `ok`.
4. Delete the old token in AWX → user → Tokens.

## 8. Revocation (incident path)

1. AWX → Access → Users → `svc-drcc-labops-ai-ro` → Tokens → delete all.
2. Set the user to **inactive** (do not delete: job history attribution is kept).
3. Remove the team's role grants if the account is being retired.
4. Restart the gateway; AWX-backed views degrade to "unavailable" and nothing else breaks.

Recovery is simply re-running §4.

## Approval requested

- [ ] Account name, team name and the exact role grants in §3.
- [ ] Create the account + token and hold it until I ask.
