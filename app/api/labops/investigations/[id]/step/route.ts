import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, isUuid, jsonError } from "@/lib/labops/http";
import { decideAgentStep, type StepDecisionFailureCode } from "@/lib/labops/runs";

export const dynamic = "force-dynamic";

const statusForCode: Record<StepDecisionFailureCode, number> = {
  run_not_found: 404,
  not_awaiting_approval: 409,
};

const bodySchema = z.object({
  accept: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Decides the agent action an investigation is waiting on. Every action the agent
 * proposes is held by the agent server's confirmation policy, so this is what lets a run
 * proceed at all — and it stays owner-only, like starting and cancelling.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("confirm_agent_step");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError(404, "That investigation does not exist.", { code: "not_found" });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(400, "accept must be true or false.", { code: "invalid_request" });
  }

  try {
    const result = await decideAgentStep(runDeps(), {
      identity: gate.identity,
      runId: id,
      accept: parsed.data.accept,
      reason: parsed.data.reason,
    });

    if (!result.ok) {
      return jsonError(statusForCode[result.code], result.reason, { code: result.code });
    }

    return NextResponse.json({ investigation: result.run });
  } catch (error) {
    return failureResponse(error, "Could not send that decision to the investigation.");
  }
}
