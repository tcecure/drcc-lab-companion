import { NextResponse } from "next/server";

import { agentClient } from "@/lib/labops/agent";
import { describeLabOpsConfig, isLabOpsConfigured } from "@/lib/labops/config";
import { guard } from "@/lib/labops/http";
import { labopsStore } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

/**
 * Staff-visible readiness for the LabOps pilot. Reports whether the gateway can reach
 * its private agent server, never how: no agent URL, no key, no provider credential.
 */
export async function GET() {
  const gate = await guard("read_investigations");

  if (!gate.ok) {
    return gate.response;
  }

  const config = describeLabOpsConfig();
  const store = labopsStore();

  let agent: { status: "ok" | "down" } = { status: "down" };

  try {
    agent = (await agentClient().health()).ok ? { status: "ok" } : { status: "down" };
  } catch {
    agent = { status: "down" };
  }

  const [activeRuns, monthToDateCostUsd] = await Promise.all([
    store.countActiveRuns(),
    store.monthToDateCostUsd(),
  ]);

  await store
    .recordIntegrationHealth(
      "openhands_agent_server",
      agent.status === "ok" ? "ok" : "down",
      agent.status === "ok" ? null : "Health probe failed from the gateway.",
    )
    .catch(() => undefined);

  return NextResponse.json({
    configured: isLabOpsConfigured(),
    agentServer: agent.status,
    provider: config.provider,
    model: config.model,
    limits: config.limits,
    usage: {
      activeRuns,
      monthToDateCostUsd,
      monthlyBudgetUsd: config.limits.monthlyCostBudgetUsd,
    },
  });
}
