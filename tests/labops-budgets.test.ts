import { describe, expect, it } from "vitest";

import {
  addUsage,
  canStartRun,
  evaluateRunBudget,
  statusForStopReason,
  zeroUsage,
  type LabOpsLimits,
} from "@/lib/labops/budgets";

const limits: LabOpsLimits = {
  runTokenBudget: 1000,
  runCostBudgetUsd: 5,
  monthlyCostBudgetUsd: 150,
  runWallclockMinutes: 20,
  maxActiveRuns: 1,
};

const start = Date.parse("2026-08-24T12:00:00.000Z");

describe("LabOps AI investigation limits", () => {
  it("allows one investigation at a time", () => {
    expect(canStartRun(limits, { activeRuns: 0, monthToDateCostUsd: 0 }).allowed).toBe(true);

    const blocked = canStartRun(limits, { activeRuns: 1, monthToDateCostUsd: 0 });

    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.code).toBe("active_run_exists");
  });

  it("refuses to start once the monthly budget is spent", () => {
    const blocked = canStartRun(limits, { activeRuns: 0, monthToDateCostUsd: 150 });

    expect(blocked.allowed === false && blocked.code).toBe("monthly_budget_exhausted");
  });

  it("continues while inside every limit", () => {
    const decision = evaluateRunBudget(limits, {
      usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.4 },
      startedAt: start,
      now: start + 60_000,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.shouldContinue === true && decision.remaining.tokens).toBe(850);
    expect(decision.shouldContinue === true && decision.remaining.ms).toBe(19 * 60_000);
  });

  it("stops on the token budget", () => {
    const decision = evaluateRunBudget(limits, {
      usage: { promptTokens: 900, completionTokens: 150, costUsd: 0.1 },
      startedAt: start,
      now: start + 1000,
    });

    expect(decision.shouldContinue === false && decision.stopReason).toBe("token_budget");
  });

  it("stops on the per-run cost budget", () => {
    const decision = evaluateRunBudget(limits, {
      usage: { promptTokens: 10, completionTokens: 10, costUsd: 5.01 },
      startedAt: start,
      now: start + 1000,
    });

    expect(decision.shouldContinue === false && decision.stopReason).toBe("cost_budget");
  });

  it("stops on the wall clock", () => {
    const decision = evaluateRunBudget(limits, {
      usage: zeroUsage,
      startedAt: start,
      now: start + 20 * 60_000,
    });

    expect(decision.shouldContinue === false && decision.stopReason).toBe("wallclock");
  });

  it("stops when the month is exhausted mid-run", () => {
    const decision = evaluateRunBudget(limits, {
      usage: zeroUsage,
      startedAt: start,
      now: start + 1000,
      monthToDateCostUsd: 150,
    });

    expect(decision.shouldContinue === false && decision.stopReason).toBe("monthly_budget");
  });

  it("maps stop reasons to run statuses", () => {
    expect(statusForStopReason("wallclock")).toBe("timed_out");
    expect(statusForStopReason("token_budget")).toBe("budget_exhausted");
    expect(statusForStopReason("monthly_budget")).toBe("budget_exhausted");
  });

  it("accumulates usage without floating point drift", () => {
    const usage = addUsage(
      { promptTokens: 10, completionTokens: 5, costUsd: 0.1 },
      { promptTokens: 3, completionTokens: 2, costUsd: 0.2 },
    );

    expect(usage).toEqual({ promptTokens: 13, completionTokens: 7, costUsd: 0.3 });
  });
});
