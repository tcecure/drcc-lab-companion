import "server-only";

import { z } from "zod";

import type { LabOpsLimits } from "@/lib/labops/budgets";

/**
 * Server-side configuration for LabOps AI.
 *
 * Every value here is read on the gateway host only (/etc/labops/labops.env on
 * drcc-labops-01). No LABOPS_* value is prefixed NEXT_PUBLIC_, so none of it can reach
 * browser code, and the model key is never returned by an API route.
 */
const labopsSchema = z.object({
  LABOPS_OWNER_EMAIL: z.string().email(),
  LABOPS_PUBLIC_URL: z.string().url().default("https://labops.digitalrcc.com"),

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

  // Private agent server, reachable only over loopback on drcc-labops-01.
  LABOPS_AGENT_SERVER_URL: z.string().url().default("http://127.0.0.1:8000"),
  LABOPS_AGENT_SERVER_API_KEY: z.string().min(1),
  LABOPS_AGENT_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Read-only integrations.
  LABOPS_AWX_URL: z.string().url().optional(),
  LABOPS_AWX_TOKEN: z.string().min(1).optional(),
  LABOPS_WIKI_URL: z.string().url().optional(),
  LABOPS_TRACKER_URL: z.string().url().optional(),
});

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
      Object.keys(labopsSchema.shape).map((key) => [key, value(process.env[key])]),
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
    awxConfigured: Boolean(config.LABOPS_AWX_URL && config.LABOPS_AWX_TOKEN),
  };
}
