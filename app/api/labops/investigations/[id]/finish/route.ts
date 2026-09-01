import { NextResponse, type NextRequest } from "next/server";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, isUuid, jsonError } from "@/lib/labops/http";
import { finishDirectConversation } from "@/lib/labops/runs";

export const dynamic = "force-dynamic";

const statusForCode = {
  run_not_found: 404,
  not_direct: 409,
  already_terminal: 409,
} as const;

/**
 * Ends a direct conversation the operator is done with: the run succeeds and its
 * container and volume are destroyed. The transcript stays readable afterwards.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("cancel_investigation");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError(404, "That conversation does not exist.", { code: "not_found" });
  }

  try {
    const result = await finishDirectConversation(runDeps(), {
      identity: gate.identity,
      runId: id,
    });

    if (!result.ok) {
      return jsonError(statusForCode[result.code], result.reason, { code: result.code });
    }

    return NextResponse.json({ investigation: result.run });
  } catch (error) {
    return failureResponse(error, "Could not finish the conversation.");
  }
}
