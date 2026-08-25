/**
 * Per-investigation token, cost and wall-clock limits, plus the single-active-run gate.
 *
 * The database enforces the same rules (ai_runs_single_active_idx, usage rows), but the
 * gateway checks them before spending anything so a refusal is cheap and explainable.
 */

export type LabOpsLimits = {
  runTokenBudget: number;
  runCostBudgetUsd: number;
  monthlyCostBudgetUsd: number;
  runWallclockMinutes: number;
  maxActiveRuns: number;
};

export type UsageSnapshot = {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export const zeroUsage: UsageSnapshot = {
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
};

export function totalTokens(usage: UsageSnapshot) {
  return usage.promptTokens + usage.completionTokens;
}

export function addUsage(a: UsageSnapshot, b: UsageSnapshot): UsageSnapshot {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    costUsd: Number((a.costUsd + b.costUsd).toFixed(6)),
  };
}

export type StartDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "active_run_exists" | "monthly_budget_exhausted";
      reason: string;
    };

export function canStartRun(
  limits: LabOpsLimits,
  state: { activeRuns: number; monthToDateCostUsd: number },
): StartDecision {
  if (state.activeRuns >= limits.maxActiveRuns) {
    return {
      allowed: false,
      code: "active_run_exists",
      reason:
        limits.maxActiveRuns === 1
          ? "An investigation is already running. Finish or cancel it first."
          : `The limit of ${limits.maxActiveRuns} concurrent investigations is in use.`,
    };
  }

  if (state.monthToDateCostUsd >= limits.monthlyCostBudgetUsd) {
    return {
      allowed: false,
      code: "monthly_budget_exhausted",
      reason: `The monthly model budget of $${limits.monthlyCostBudgetUsd.toFixed(2)} is exhausted.`,
    };
  }

  return { allowed: true };
}

export type RunStopReason =
  | "token_budget"
  | "cost_budget"
  | "monthly_budget"
  | "wallclock";

export type ContinueDecision =
  | { shouldContinue: true; remaining: { tokens: number; costUsd: number; ms: number } }
  | { shouldContinue: false; stopReason: RunStopReason; reason: string };

/**
 * Evaluated before each model call. `startedAt`/`now` are epoch milliseconds so the
 * caller decides the clock source.
 */
export function evaluateRunBudget(
  limits: LabOpsLimits,
  run: {
    usage: UsageSnapshot;
    startedAt: number;
    now: number;
    monthToDateCostUsd?: number;
  },
): ContinueDecision {
  const used = totalTokens(run.usage);
  const elapsedMs = Math.max(0, run.now - run.startedAt);
  const wallclockMs = limits.runWallclockMinutes * 60_000;

  if (used >= limits.runTokenBudget) {
    return {
      shouldContinue: false,
      stopReason: "token_budget",
      reason: `Token budget of ${limits.runTokenBudget.toLocaleString()} reached for this investigation.`,
    };
  }

  if (run.usage.costUsd >= limits.runCostBudgetUsd) {
    return {
      shouldContinue: false,
      stopReason: "cost_budget",
      reason: `Cost budget of $${limits.runCostBudgetUsd.toFixed(2)} reached for this investigation.`,
    };
  }

  if ((run.monthToDateCostUsd ?? 0) >= limits.monthlyCostBudgetUsd) {
    return {
      shouldContinue: false,
      stopReason: "monthly_budget",
      reason: `The monthly model budget of $${limits.monthlyCostBudgetUsd.toFixed(2)} is exhausted.`,
    };
  }

  if (elapsedMs >= wallclockMs) {
    return {
      shouldContinue: false,
      stopReason: "wallclock",
      reason: `The ${limits.runWallclockMinutes}-minute time limit for an investigation elapsed.`,
    };
  }

  return {
    shouldContinue: true,
    remaining: {
      tokens: limits.runTokenBudget - used,
      costUsd: Number((limits.runCostBudgetUsd - run.usage.costUsd).toFixed(6)),
      ms: wallclockMs - elapsedMs,
    },
  };
}

/** Terminal ai_runs status matching a budget stop, so the UI and audit agree. */
export function statusForStopReason(reason: RunStopReason) {
  return reason === "wallclock" ? "timed_out" : "budget_exhausted";
}
