import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, jsonError } from "@/lib/labops/http";
import { recordResolution } from "@/lib/labops/runs";
import { labopsStore, summarizeRun } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const resolutionSchema = z
  .object({
    findings: z.string().max(20_000).optional(),
    resolution: z.string().max(20_000).optional(),
  })
  .refine((value) => value.findings !== undefined || value.resolution !== undefined, {
    message: "Provide findings, a resolution, or both.",
  });

/** Investigation detail: status, usage, redacted timeline, transcript and audit trail. */
export async function GET(_request: NextRequest, { params }: Params) {
  const gate = await guard("read_investigations");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  try {
    const store = labopsStore();
    const run = await store.getRun(id);

    if (!run) {
      return jsonError(404, "That investigation does not exist.", { code: "not_found" });
    }

    const [usage, events, messages, toolActions, approvals] = await Promise.all([
      store.runUsage(run.id),
      store.listEvents(run.id),
      store.listMessages(run.id),
      store.listToolActions(run.id),
      store.listApprovals(run.id),
    ]);

    return NextResponse.json({
      investigation: summarizeRun(run, usage),
      // Sanitized copy of the ticket the agent was given, so staff can audit exactly
      // what left the portal.
      context: run.sanitized_context,
      events: events.map((event) => ({
        seq: event.seq,
        kind: event.kind,
        payload: event.payload,
        createdAt: event.created_at,
      })),
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
      })),
      toolActions: toolActions.map((action) => ({
        tool: action.tool,
        target: action.target,
        isWrite: action.is_write,
        outcome: action.outcome,
        summary: action.response_summary,
        createdAt: action.created_at,
      })),
      approvals: approvals.map((approval) => ({
        id: approval.id,
        actionKind: approval.action_kind,
        status: approval.status,
        requestedBy: approval.requested_by,
        decidedBy: approval.decided_by,
        decidedAt: approval.decided_at,
        decisionNote: approval.decision_note,
        expiresAt: approval.expires_at,
        createdAt: approval.created_at,
      })),
    });
  } catch (error) {
    return failureResponse(error, "Could not read the investigation.");
  }
}

/**
 * Records the operator's findings and resolution. The support request stays
 * authoritative and is not written here.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const gate = await guard("start_investigation");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;
  const parsed = resolutionSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(400, "Provide findings, a resolution, or both.", {
      code: "invalid_request",
    });
  }

  try {
    const result = await recordResolution(runDeps(), {
      runId: id,
      findings: parsed.data.findings,
      resolution: parsed.data.resolution,
    });

    if (!result.ok) {
      return jsonError(404, result.reason, { code: "not_found" });
    }

    return NextResponse.json({ investigation: result.run });
  } catch (error) {
    return failureResponse(error, "Could not record the resolution.");
  }
}
