import { NextResponse, type NextRequest } from "next/server";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, isUuid, jsonError } from "@/lib/labops/http";
import { publishReviewedFindings } from "@/lib/labops/runs";

export const dynamic = "force-dynamic";

const statusForCode = {
  run_not_found: 404,
  no_findings: 409,
  writes_disabled: 409,
} as const;

/**
 * Files the reviewed findings on the ticket as an internal system note.
 *
 * Nothing automatic reaches this route: a human reads the investigation first, and the
 * `support_notes` write switch has to be on. The note is internal, attributed to the
 * portal rather than to the operator, and leaves status, priority and the student-facing
 * conversation untouched.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("file_findings_note");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError(404, "That investigation does not exist.", { code: "not_found" });
  }

  try {
    const result = await publishReviewedFindings(runDeps(), {
      runId: id,
      actorUserId: gate.identity.userId,
    });

    if (!result.ok) {
      return jsonError(statusForCode[result.code], result.reason, { code: result.code });
    }

    return NextResponse.json({ created: result.created });
  } catch (error) {
    return failureResponse(error, "Could not add the findings note.");
  }
}
