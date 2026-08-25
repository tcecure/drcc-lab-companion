# DigitalRCC LabOps AI — inventory of the existing implementation (read-only)

Date: 2026-08-24. Nothing on the inventoried hosts was modified; `crc.ai.tcecure.com`
is still serving.

## 1. `crc.ai` — what it actually is

| Item | Value |
|---|---|
| Public hostname | `crc.ai.tcecure.com` (HTTPS via the lab edge proxy; returns 307 to `/login`) |
| Host VM | `crc-ai-ide-01`, VMID 105 on pve2, Ubuntu 22.04, 8 vCPU / 49 GB RAM configured (≈14 GB touched) / 200 GB disk |
| Guest IP | `192.168.1.61` (same VM as the training tracker) |
| Web tier | nginx (`:80` only, TLS terminated upstream) → `127.0.0.1:4000` |
| App | Next.js 14 app (`portal.service`, `npx next start -p 4000`) from `/opt/cyberlab-ai/repo/portal`, a symlink into a checkout of `ebarlowjr2/tcecure_cyberlab` (HEAD = merge of PR #14) |
| Auth | `next-auth` + `bcryptjs` + Prisma against a **local** PostgreSQL 14 on the same VM — a second, separate user directory from Supabase |
| Tool backend | `mcp.service`: FastAPI/uvicorn on `127.0.0.1:8000` from `/opt/cyberlab-ai/mcp/main.py` ("CyberLab MCP Server v2") |
| OpenHands | Images pulled (`ghcr.io/openhands/openhands:latest`, `ghcr.io/openhands/agent-server:1.15.0-python`), an nginx vhost exists, but **no container is running** and nothing listens on :3000 — the integration was never operational |

### Existing features worth keeping

- `portal/src/app/dashboard/page.tsx` — health tiles (AWX / OpenHands / DB) and lab status.
- `portal/src/app/api/health/route.ts` — probes OpenHands via `GET /api/options/config`; reusable as the agent-server health check.
- `portal/src/app/ide/page.tsx` — iframes the stock OpenHands UI from `NEXT_PUBLIC_OPENHANDS_URL`. **Not reusable** under the new spec: it exposes stock OpenHands branding and its API to the browser.
- `mcp/main.py` — AWX integration: `get_awx_headers`, `call_awx(template_id, extra_vars)`, `/lab-status`, `/tools/verify_lab`, `/tools/reseed_lab`, `/tools/reset_pod`, `/tools`, `/health`, plus a `check_permission(role, action)` matrix. The AWX client and `/lab-status` port cleanly into the new gateway.

### Concerns found (all pre-existing; none changed)

1. `mcp.service` carries the AWX API token and a shared `PORTAL_SECRET` **in plaintext in the unit file** (readable by anyone who can run `systemctl cat`). The secret's own value says "change-in-production".
2. Authorization is a single static bearer secret, so any process able to read the unit file can invoke lab-mutating tools.
3. `/tools/reset_pod` and `/tools/reseed_lab` are **write** actions against AWX with no approval gate, no audit record and no idempotency — exactly what the new spec forbids in Phase 1.
4. Identity is local (Prisma/next-auth), duplicating Supabase accounts and roles.
5. `ghcr.io/openhands/openhands:latest` is a floating tag; the spec requires pinned versions/digests.
6. The portal listens on `0.0.0.0:4000`, reachable from the whole lab LAN, not just nginx.

### Recommendation

Do not extend `crc.ai`. Treat it as a reference implementation: port the AWX client,
`/lab-status` and the health-probe shapes into the new gateway, and leave the VM
running untouched so the tracker and the existing dashboard keep working. The new
platform gets its own VM on pve2 (see sizing) so `crc.ai` is never in the blast radius.

## 2. DigitalRCC portal (`my.digitalrcc.com`)

- Repo `tcecure/drcc-lab-companion`; Next.js 16 / React 19, `@supabase/ssr`, `zod`; deployed on Vercel (`my.digitalrcc.com` CNAMEs to `vercel-dns-017.com`).
- Auth/roles: `lib/auth.ts` — Supabase `auth.getUser()`, roles via `user_roles → roles.role_name`, and today only three roles exist: `student`, `approver`, `admin`.
- Design system to reuse: `components/app-shell.tsx`, `card.tsx`, `forms.tsx`, `lab-status.tsx`, `training-progress.tsx`, `app/globals.css`.
- Server env contract in `lib/env.ts` already includes Proxmox, tracker and SES settings; the LabOps additions belong in the same schema.

## 3. Supabase (project `DRCC`, `kkacbtkacadgsnbylkti`, us-west-2)

33 public tables. Directly relevant to LabOps AI:

| Table | Use for LabOps AI |
|---|---|
| `support_requests` (user_id, lab_assignment_id, category, subject, description, priority, status, assigned_to, resolved_at) | **The ticket source.** No new ticket table needed. |
| `profiles`, `roles`, `user_roles` | Identity and authorization; needs three new role rows, no schema change. |
| `audit_events` (actor_id, action, entity_type, entity_id, previous_value, new_value, source_ip) | Staff + approval audit trail; reuse rather than inventing an audit table. |
| `integration_events` (outbox: event_type, payload, idempotency_key, status, attempts, delivered_at) | Existing outbox pattern for gateway → n8n/AWX notifications. |
| `lab_progress`, `lab_verifications`, `lab_status_snapshots`, `lab_sync_runs`, `lab_instances`, `lab_assignments` | Read-only context the agent may query about a pod. |

Gap: nothing exists for AI runs, agent messages, run events, artifacts, tool actions,
approval requests, knowledge proposals or model usage. Those are the only new tables
proposed, and they arrive as reviewed migrations — see ADR 0001.

## 4. DNS / TLS facts

- `labops.drcc.digitalrcc.com` — **does not resolve today**. `digitalrcc.com` NS = `dns{1,2}.registrar-servers.com` (Namecheap); `my.digitalrcc.com` is a Vercel CNAME.
- Three labels, so a single `CNAME` at Namecheap is enough and Vercel issues the certificate; no wildcard is involved. See `checkpoint-dns-tls.md`.
- The lab's own names (`crc.ai.tcecure.com`, `training.status.tcecure.com`) live under `tcecure.com` in Route 53 and resolve to the lab edge IP, which is where a self-hosted host record would have to point.

## 5. Model provider

Decision: **OpenAI API** (Bedrock dropped; no AWS credentials are needed or requested).
OpenHands calls the provider through LiteLLM, so the model is a provider-prefixed string
(`openai/<model>`) and the key is `LLM_API_KEY` on the agent host. Provider and model are
env-configured behind a gateway-side interface, so swapping providers later is
configuration. See `checkpoint-openai-config.md`.
