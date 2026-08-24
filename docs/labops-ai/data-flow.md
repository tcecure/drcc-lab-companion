# LabOps AI data flow (Phase 1)

```
 staff browser                Vercel                     pve2 (internal only)
 ────────────                 ──────                     ───────────────────
 my.ai.digitalrcc.com
   │ Supabase session cookie
   ▼
 Next.js app (branded)
   │ fetch /api/labops/*  (same origin)
   ▼
 AI Gateway / BFF ──────────────┐
   │  1 verify Supabase JWT     │ reads/writes  ┌──────────────┐
   │  2 resolve roles           ├──────────────►│  Supabase    │ support_requests, profiles,
   │  3 rate limit + validate   │               │  (DRCC)      │ user_roles, ai_* tables,
   │  4 redact secrets          │               └──────────────┘ audit_events, integration_events
   │  5 audit                   │
   │                            ├──────────────►│ Wiki.js (read published pages)
   │                            ├──────────────►│ AWX  (read-only: job status, stdout)
   │                            ├──────────────►│ Wazuh (restricted read-only account)
   │                            ├──────────────►│ Proxmox (inventory / status, read-only token)
   │                            └──────────────►│ GitHub (read; Phase 2: branch + PR)
   │ bearer/mTLS, private network only
   ▼
 OpenHands Agent Server (pinned digest, loopback + internal proxy)
   │ spawns one container per investigation
   ▼
 Workspace container
   - no host mounts, no infra credentials
   - 2 vCPU / 4 GB / 10 GB / 20 min caps
   - egress: allow-listed hosts only
   - destroyed on run completion
```

Streaming: the agent server emits run events → gateway persists them to `ai_run_events`
and relays a sanitized stream (SSE) to the browser. The browser never talks to the agent
server.

Secrets: only the gateway's server-side environment holds model, AWX, Wazuh, Proxmox,
GitHub and Supabase service credentials. Nothing sensitive is exposed as
`NEXT_PUBLIC_*`, and no credential is passed into a workspace.

Retention: run rows and timelines kept indefinitely (audit); artifacts and workspace
output 30 days; attachments 30 days; model usage aggregated monthly for cost reporting.
