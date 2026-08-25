import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { failureResponse, guard, isUuid, jsonError } from "@/lib/labops/http";
import { canDecideSpecificApproval } from "@/lib/labops/policy";
import { labopsStore } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2_000).optional(),
});

/**
 * Decides a pending approval request. Every agent action that touches lab systems is
 * confirmation-gated, and an approval can never be decided by the account that raised it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("decide_approval");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError(404, "That approval request does not exist.", { code: "not_found" });
  }

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(400, "A decision of approved or rejected is required.", {
      code: "invalid_request",
    });
  }

  try {
    const store = labopsStore();
    const approval = await store.getApproval(id);

    if (!approval) {
      return jsonError(404, "That approval request does not exist.", { code: "not_found" });
    }

    if (approval.status !== "pending") {
      return jsonError(409, "That approval request is no longer pending.", {
        code: "conflict",
      });
    }

    const decision = canDecideSpecificApproval(gate.identity, {
      requestedBy: approval.requested_by,
    });

    if (!decision.allowed) {
      return jsonError(403, decision.reason, { code: "forbidden" });
    }

    const decided = await store.decideApproval(id, {
      status: parsed.data.decision,
      decidedBy: gate.identity.userId,
      note: parsed.data.note ?? null,
    });

    await store.recordToolAction({
      runId: decided.run_id,
      tool: `approval.${decided.action_kind}`,
      outcome: decided.status === "approved" ? "allowed" : "denied",
      responseSummary: `Approval ${decided.status} by ${gate.identity.email ?? gate.identity.userId}.`,
    });

    return NextResponse.json({
      approval: {
        id: decided.id,
        runId: decided.run_id,
        actionKind: decided.action_kind,
        status: decided.status,
        decidedBy: decided.decided_by,
        decidedAt: decided.decided_at,
        decisionNote: decided.decision_note,
      },
    });
  } catch (error) {
    return failureResponse(error, "Could not decide the approval request.");
  }
}
