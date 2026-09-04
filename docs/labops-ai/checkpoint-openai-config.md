# Approval checkpoint — OpenAI configuration and secret handling

**No OpenAI account, key or billing has been created or requested by Devin.** This
document states exactly what is needed, where it goes, and what the code does with it, so
the key can be installed once — by you, on `drcc-labops-01` — when the gateway is ready.

## 1. Model selection against the pinned release

OpenHands calls providers through **LiteLLM**, so a model is a provider-prefixed string
and any OpenAI chat model LiteLLM supports is reachable without code changes.

Facts from the pinned SDK (1.42.1, the version `OpenHands` v1.15.0 pins):

- `LLM.model` default is `gpt-5.5`; provider-prefixed strings such as `openai/gpt-4o` are explicitly documented as the way to disambiguate the provider.
- `num_retries` defaults to `5`, `timeout` to `300s`, and `max_output_tokens` is derived from LiteLLM's model info when unset.
- Function/tool calling is required by the agent loop, so the model must support tools and structured output.

| Role | Value | Why |
|---|---|---|
| Primary | `openai/gpt-5.5` | The SDK's own default for this release, so it is the best-tested path; needs tool calling, which it has |
| Fallback / cost control | `openai/gpt-4o` | Widely supported by LiteLLM, cheaper, adequate for summarisation and log triage |

Both are configuration, not code. The first thing I do once the key exists is a
**compatibility smoke test** — one trivial tool-calling conversation per model, run against a
designated test ticket on the production host (there is no staging; see
`production-first-workflow.md`) and recorded in `docs/labops-ai/`. The primary model is only
fixed after it passes — I am
not asking you to trust a model name chosen from documentation alone.

## 2. Environment variables

Set on `drcc-labops-01` only. `LABOPS_*` are read by the gateway; the `LLM_*` values are
what the gateway passes to the agent server when it creates a conversation.

| Variable | Example | Notes |
|---|---|---|
| `LABOPS_LLM_PROVIDER` | `openai` | Selects the provider adapter; the abstraction exists so this can become `anthropic`, `azure`, … without code changes |
| `LABOPS_LLM_MODEL` | `openai/gpt-5.5` | Never hard-coded |
| `LABOPS_LLM_FALLBACK_MODEL` | `openai/gpt-4o` | Optional |
| `LABOPS_LLM_API_KEY` | `sk-…` | **The secret.** Only ever read server-side, never logged, never returned |
| `LABOPS_LLM_BASE_URL` | *(unset)* | Only for an OpenAI-compatible proxy |
| `LABOPS_LLM_REQUEST_TIMEOUT_S` | `120` | Below the 300 s SDK default so the UI fails fast |
| `LABOPS_LLM_MAX_RETRIES` | `3` | Bounded; a 429 storm must not spin |
| `LABOPS_RUN_TOKEN_BUDGET` | `250000` | Per investigation, enforced by the gateway |
| `LABOPS_RUN_COST_BUDGET_USD` | `5.00` | Per investigation |
| `LABOPS_MONTHLY_COST_BUDGET_USD` | `150.00` | Hard ceiling across all runs |
| `LABOPS_RUN_WALLCLOCK_MINUTES` | `20` | Run is cancelled at the limit |
| `LABOPS_MAX_ACTIVE_RUNS` | `1` | Pilot value |
| `LABOPS_OWNER_EMAIL` | `<eddie's portal email>` | The only account allowed to start a run |
| `LABOPS_AGENT_SERVER_URL` | *(unset in Phase 2)* | Phase 1 pointed this at a single shared agent on loopback. Phase 2 launches one container per investigation and resolves its address at run time, so the gateway no longer has a fixed agent URL |
| `LABOPS_AGENT_SERVER_API_KEY` | generated locally | Agent server `SESSION_API_KEY`; gateway is the only holder |
| `LABOPS_AGENT_WEBHOOK_SECRET` | generated locally | Authenticates agent-server → gateway event webhook |

No `NEXT_PUBLIC_*` variable carries any of these. The template lives in
`crc-awx-labops/platform/labops-ai/env/labops.env.example` with placeholders only.

## 3. Where the key lives

```
/etc/labops/model-proxy.env   root:root  0600   (the model proxy's EnvironmentFile)
```

Phase 2 moved it: the key is no longer in the gateway's environment at all. The gateway holds
the non-secret sentinel `LABOPS_LLM_API_KEY=via-model-proxy` because its config check requires
the variable to exist, and reaches the provider only through the proxy on the internal
`labops-model` network. See `platform/labops-ai/docs/phase2/06-apply-log.md` in
`crc-awx-labops`.

- Not in Git (either repo), not in Vercel, not in Supabase, not in any table, not in a support request, not in a workspace container, not in a prompt.
- Not printed by any gateway route: `/api/labops/config` returns provider and model *names* and budget numbers only, and there is a test asserting the response body never matches the key.
- Redaction runs on model input, model output, stored artifacts and logs, so a leaked value cannot be persisted even if the agent were tricked into echoing it.
- Workspace containers get no provider credential at all: the container asks the model proxy with a per-run token, and the proxy is the only holder of the key.
- `DO_NOT_TRACK=1` on the agent server, so no prompt or usage data goes to any third-party analytics.

Rotation: replace the value in `/etc/labops/model-proxy.env`, `systemctl restart
labops-model-proxy`, then revoke the old key in the OpenAI dashboard. In-flight runs fail
closed with a clear reason; nothing else is affected. Revocation is the same minus the
replacement.

## 4. Limits and failure handling (what the gateway enforces)

| Condition | Behaviour |
|---|---|
| Second run attempted while one is active | 409 with the active run id; no provider call is made |
| Per-run token or cost budget exhausted | Run stops at the boundary, marked `budget_exhausted`, partial findings kept, operator told which limit hit |
| Monthly ceiling reached | New runs refused with a clear message; read-only views keep working |
| Wall-clock limit | `POST /conversations/{id}/interrupt`, workspace destroyed, run marked `timed_out` |
| OpenAI timeout | Bounded retries with jitter, then run marked `provider_timeout` |
| OpenAI 429 | Respect `Retry-After`, bounded attempts, then `rate_limited` — never an unbounded loop |
| OpenAI 5xx / connection error | Bounded retry, optional fallback model if configured, then `provider_error` |
| Invalid or revoked key | Run refused immediately, `provider_auth_failed`, alert on the dashboard; no key material in the message |

Every run records `prompt_tokens`, `completion_tokens`, model, and computed cost in
`ai_model_usage`, keyed by run and support request, so spend is attributable per
investigation.

## 5. Provider abstraction

The gateway depends on a narrow interface (`createConversation`, `sendMessage`,
`streamEvents`, `interrupt`, `usage`) with an OpenAI-specific implementation selected by
`LABOPS_LLM_PROVIDER`. Swapping providers is a new adapter plus env change — no UI, schema
or workflow changes. All Bedrock requirements, IAM policies and credentials have been
removed from the plan.

## 6. What I need from you, and when

Not yet. Once the isolation controls pass on the production host — secret separation, per-run
workspace isolation, default-deny agent egress, dynamic per-run gateway attachment, cleanup and
restart recovery, model-proxy credential isolation and cross-investigation denial — I will ask
once for:

1. An OpenAI **project-scoped** API key (restricted to that project, not an org-wide key), which you install yourself in `/etc/labops/labops.env` — I never need to see it.
2. Confirmation of the monthly ceiling to set in the OpenAI dashboard (a provider-side hard limit as well as the app-side one).

## Approval requested

- [ ] Primary model `openai/gpt-5.5`, fallback `openai/gpt-4o`, both confirmed by a smoke test against a designated test ticket before being fixed.
- [ ] Budgets: 250k tokens / \$5 per investigation, \$150 per month, 20-minute runs, one active run.
- [ ] Key stored only at `/etc/labops/labops.env` on `drcc-labops-01`, installed by you.
