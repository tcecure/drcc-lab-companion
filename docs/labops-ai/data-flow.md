# LabOps AI data flow (Phase 1)

```
 staff browser                Vercel                     drcc-labops-01 / pve2 (internal only)
 ────────────                 ──────                     ────────────────────────────────────
 labops.digitalrcc.com
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
   │                            ├──────────────►│ AWX  (svc-drcc-labops-ai-ro: job status, stdout)
   │                            ├──────────────►│ Proxmox (inventory / status, read-only token)
   │                            └──────────────►│ GitHub (read; Phase 2: branch + PR)
   │ bearer/mTLS, private network only
   ▼
 OpenHands Agent Server (agent-server:1.42.1-python @ sha256:141a36…, loopback + internal proxy)
   │ SESSION_API_KEY bearer; OpenAI called from here via LiteLLM
   │ spawns one container per investigation
   ▼
 Workspace container
   - no host mounts, no infra credentials
   - 2 vCPU / 4 GB / 10 GB / 20 min caps
   - egress: allow-listed hosts only
   - destroyed on run completion
```

Streaming: the agent server pushes events to the gateway webhook and exposes
`WebSocket /conversations/{id}/events/socket`; the gateway persists them to
`ai_run_events` and relays a sanitized SSE stream to the browser. The browser never talks
to the agent server.

Tickets: `support_requests` is the only intake. Selected fields are copied into the run
after sanitization; the ticket row stays authoritative and is linked by
`ai_runs.support_request_id`.

Secrets: the OpenAI key lives only in protected server-side configuration on
`drcc-labops-01`; the gateway's server-side environment holds AWX, Proxmox, GitHub and
Supabase service credentials. No secret is exposed as `NEXT_PUBLIC_*`, returned by any
gateway route, written to Supabase, logged, or passed into a workspace.

Retention: run rows and timelines kept indefinitely (audit); artifacts and workspace
output 30 days; attachments 30 days; model usage aggregated monthly for cost reporting.
