import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, isUuid, jsonError } from "@/lib/labops/http";
import {
  directPromptMaxLength,
  sendDirectMessage,
  type DirectMessageFailureCode,
} from "@/lib/labops/runs";

export const dynamic = "force-dynamic";

const messageSchema = z.object({
  prompt: z.string().trim().min(1).max(directPromptMaxLength),
});

const statusForCode: Record<DirectMessageFailureCode, number> = {
  run_not_found: 404,
  not_direct: 409,
  not_ready: 409,
  prompt_invalid: 400,
  limit_reached: 409,
  agent_unavailable: 502,
};

/**
 * Follow-up message in a direct conversation. Owner-only, and only while the run is
 * Ready: the agent's own container and OpenHands conversation are reused, so the thread
 * keeps its context instead of starting again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("start_investigation");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError(404, "That conversation does not exist.", { code: "not_found" });
  }

  const parsed = messageSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(
      400,
      `Enter a message of up to ${directPromptMaxLength.toLocaleString()} characters.`,
      { code: "invalid_request" },
    );
  }

  try {
    const result = await sendDirectMessage(runDeps(), {
      identity: gate.identity,
      runId: id,
      prompt: parsed.data.prompt,
    });

    if (!result.ok) {
      return jsonError(statusForCode[result.code], result.reason, { code: result.code });
    }

    return NextResponse.json({ investigation: result.run }, { status: 202 });
  } catch (error) {
    return failureResponse(error, "Could not send the message.");
  }
}
