import "server-only";

/** Builds the orchestration dependencies from server-side configuration. */

import { agentClient, agentClientForEndpoint } from "@/lib/labops/agent";
import { modelProxyBaseUrl, readLabOpsConfig, readLabOpsLimits } from "@/lib/labops/config";
import type { RunDeps } from "@/lib/labops/runs";
import { labopsStore } from "@/lib/labops/store";
import { workspaceRuntime, type WorkspaceHandle } from "@/lib/labops/workspace";

export function runDeps(): RunDeps {
  const config = readLabOpsConfig();
  const shared = config.LABOPS_RUNTIME_MODE === "shared";

  return {
    store: labopsStore(),
    // Under per-run isolation there is no shared agent to point at, so the health probe
    // is the only thing that would use this client; building it lazily keeps a missing
    // LABOPS_AGENT_SERVER_URL from breaking every route.
    get agent() {
      return agentClient();
    },
    limits: readLabOpsLimits(config),
    provider: config.LABOPS_LLM_PROVIDER,
    model: config.LABOPS_LLM_MODEL,
    ...(shared
      ? {}
      : {
          runtime: workspaceRuntime(),
          agentFor: (handle: WorkspaceHandle) =>
            agentClientForEndpoint(handle.endpoint, config),
          /**
           * The container reaches the provider only through the model proxy, and only on
           * its own run path. The credential here is the proxy's bearer token, which the
           * proxy replaces with the real provider key upstream — the key itself never
           * enters the gateway or an investigation container.
           */
          llmFor: (runId: string) => ({
            model: config.LABOPS_LLM_MODEL,
            apiKey: config.LABOPS_MODEL_PROXY_TOKEN ?? "",
            baseUrl: modelProxyBaseUrl(runId, config),
            requestTimeoutSeconds: config.LABOPS_LLM_REQUEST_TIMEOUT_S,
            maxRetries: config.LABOPS_LLM_MAX_RETRIES,
          }),
          readyTimeoutMs: config.LABOPS_RUNTIME_READY_TIMEOUT_S * 1_000,
        }),
  };
}
