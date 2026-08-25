import { NextResponse, type NextRequest } from "next/server";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, jsonError } from "@/lib/labops/http";
import { cancelInvestigation, type CancelFailureCode } from "@/lib/labops/runs";

export const dynamic = "force-dynamic";

const statusForCode: Record<CancelFailureCode, number> = {
  run_not_found: 404,
  already_terminal: 409,
};

/**
 * Owner-only cancellation. The run is marked cancelled even if the agent server does not
 * confirm the stop, so a stuck agent can never keep spending against the pilot budget.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("cancel_investigation");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  try {
    const result = await cancelInvestigation(runDeps(), {
      identity: gate.identity,
      runId: id,
    });

    if (!result.ok) {
      return jsonError(statusForCode[result.code], result.reason, { code: result.code });
    }

    return NextResponse.json({ investigation: result.run });
  } catch (error) {
    return failureResponse(error, "Could not cancel the investigation.");
  }
}
