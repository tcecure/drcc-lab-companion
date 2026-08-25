import "server-only";

/** Builds the orchestration dependencies from server-side configuration. */

import { agentClient } from "@/lib/labops/agent";
import { readLabOpsConfig, readLabOpsLimits } from "@/lib/labops/config";
import type { RunDeps } from "@/lib/labops/runs";
import { labopsStore } from "@/lib/labops/store";

export function runDeps(): RunDeps {
  const config = readLabOpsConfig();

  return {
    store: labopsStore(),
    agent: agentClient(),
    limits: readLabOpsLimits(config),
    provider: config.LABOPS_LLM_PROVIDER,
    model: config.LABOPS_LLM_MODEL,
  };
}
