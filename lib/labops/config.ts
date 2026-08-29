import "server-only";

import { z } from "zod";

import type { LabOpsLimits } from "@/lib/labops/budgets";

/**
 * Server-side configuration for LabOps AI.
 *
 * Every value here is read on the gateway host only (/etc/labops/gateway.env on
 * drcc-labops-01). No LABOPS_* value is prefixed NEXT_PUBLIC_, so none of it can reach
 * browser code. Since the Phase 2 secret split the gateway holds no provider key at all:
 * LABOPS_LLM_API_KEY is the sentinel `via-model-proxy`, and the real key lives only in the
 * model proxy's own environment file.
 */
const labopsShape = z.object({
  LABOPS_OWNER_EMAIL: z.string().email(),
  LABOPS_PUBLIC_URL: z.string().url().default("https://labops.drcc.digitalrcc.com"),

  // Model provider — deliberately generic so a provider swap is configuration only.
  LABOPS_LLM_PROVIDER: z.enum(["openai"]).default("openai"),
  LABOPS_LLM_MODEL: z.string().min(1),
  LABOPS_LLM_FALLBACK_MODEL: z.string().min(1).optional(),
  LABOPS_LLM_API_KEY: z.string().min(1),
  LABOPS_LLM_BASE_URL: z.string().url().optional(),
  LABOPS_LLM_REQUEST_TIMEOUT_S: z.coerce.number().int().positive().default(120),
  LABOPS_LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),

  // Limits.
  LABOPS_RUN_TOKEN_BUDGET: z.coerce.number().int().positive().default(250_000),
  LABOPS_RUN_COST_BUDGET_USD: z.coerce.number().positive().default(5),
  LABOPS_MONTHLY_COST_BUDGET_USD: z.coerce.number().positive().default(150),
  LABOPS_RUN_WALLCLOCK_MINUTES: z.coerce.number().int().positive().default(20),
  LABOPS_MAX_ACTIVE_RUNS: z.coerce.number().int().positive().default(1),

  /**
   * How an investigation gets an agent server.
   *
   * `per_run` (Phase 2, the default) launches one container per investigation through
   * LABOPS_RUNTIME_LAUNCHER and resolves its address at run time, so there is no shared
   * workspace and no long-lived agent. `shared` is the Phase 1 topology, kept only so a
   * host can be rolled back to it, and it requires LABOPS_AGENT_SERVER_URL.
   */
  LABOPS_RUNTIME_MODE: z.enum(["per_run", "shared"]).default("per_run"),
  LABOPS_RUNTIME_LAUNCHER: z
    .string()
    .min(1)
    .default("/opt/labops/platform/labops-ai/scripts/run-investigation.sh"),
  /** The launcher creates containers, so it runs as root through a single sudoers rule. */
  LABOPS_RUNTIME_SUDO: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  LABOPS_RUNTIME_TIMEOUT_S: z.coerce.number().int().positive().default(180),
  /**
   * The model proxy on the internal network, and the bearer token it accepts. The proxy
   * substitutes the real provider key upstream, so this token is not a provider
   * credential: it is worthless anywhere except labops-model.
   */
  LABOPS_MODEL_PROXY: z.string().min(1).default("172.31.241.2:8081"),
  LABOPS_MODEL_PROXY_TOKEN: z.string().min(1).optional(),
  /** How long a freshly launched agent server gets to answer /health before the run fails. */
  LABOPS_RUNTIME_READY_TIMEOUT_S: z.coerce.number().int().positive().default(120),

  // Only used by LABOPS_RUNTIME_MODE=shared; unset under per-run isolation.
  LABOPS_AGENT_SERVER_URL: z.string().url().optional(),
  LABOPS_AGENT_SERVER_API_KEY: z.string().min(1),
  LABOPS_AGENT_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Read-only integrations.
  LABOPS_AWX_URL: z.string().url().optional(),
  LABOPS_AWX_TOKEN: z.string().min(1).optional(),
  LABOPS_WIKI_URL: z.string().url().optional(),
  LABOPS_TRACKER_URL: z.string().url().optional(),
});

const labopsSchema = labopsShape.superRefine((config, ctx) => {
  if (config.LABOPS_RUNTIME_MODE === "shared" && !config.LABOPS_AGENT_SERVER_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LABOPS_AGENT_SERVER_URL"],
      message: "LABOPS_RUNTIME_MODE=shared requires LABOPS_AGENT_SERVER_URL",
    });
  }

  if (config.LABOPS_RUNTIME_MODE === "per_run" && !config.LABOPS_MODEL_PROXY_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LABOPS_MODEL_PROXY_TOKEN"],
      message:
        "LABOPS_RUNTIME_MODE=per_run requires LABOPS_MODEL_PROXY_TOKEN so investigations can reach the model proxy",
    });
  }
});

/**
 * Provider base URL for one investigation. The run id is in the path so every model call
 * is attributable without the agent having to send a custom header, and the proxy rejects
 * a path that is not a uuid.
 */
export function modelProxyBaseUrl(runId: string, config = readLabOpsConfig()) {
  return `http://${config.LABOPS_MODEL_PROXY}/r/${runId}/v1`;
}

export type LabOpsConfig = z.infer<typeof labopsSchema>;

function value(input: string | undefined) {
  return input?.trim() || undefined;
}

let cached: LabOpsConfig | null = null;

export function readLabOpsConfig(): LabOpsConfig {
  if (cached) {
    return cached;
  }

  cached = labopsSchema.parse(
    Object.fromEntries(
      Object.keys(labopsShape.shape).map((key) => [key, value(process.env[key])]),
    ),
  );

  return cached;
}

/** True when the gateway has enough configuration to run an investigation. */
export function isLabOpsConfigured() {
  try {
    readLabOpsConfig();
    return true;
  } catch {
    return false;
  }
}

export function readLabOpsLimits(config = readLabOpsConfig()): LabOpsLimits {
  return {
    runTokenBudget: config.LABOPS_RUN_TOKEN_BUDGET,
    runCostBudgetUsd: config.LABOPS_RUN_COST_BUDGET_USD,
    monthlyCostBudgetUsd: config.LABOPS_MONTHLY_COST_BUDGET_USD,
    runWallclockMinutes: config.LABOPS_RUN_WALLCLOCK_MINUTES,
    maxActiveRuns: config.LABOPS_MAX_ACTIVE_RUNS,
  };
}

/**
 * Safe view for API responses and the UI: no key, no token, no internal agent URL.
 */
export function describeLabOpsConfig(config = readLabOpsConfig()) {
  return {
    provider: config.LABOPS_LLM_PROVIDER,
    model: config.LABOPS_LLM_MODEL,
    fallbackModel: config.LABOPS_LLM_FALLBACK_MODEL ?? null,
    requestTimeoutSeconds: config.LABOPS_LLM_REQUEST_TIMEOUT_S,
    limits: readLabOpsLimits(config),
    runtimeMode: config.LABOPS_RUNTIME_MODE,
    awxConfigured: Boolean(config.LABOPS_AWX_URL && config.LABOPS_AWX_TOKEN),
  };
}
