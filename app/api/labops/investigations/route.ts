import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { runDeps } from "@/lib/labops/gateway";
import { failureResponse, guard, jsonError } from "@/lib/labops/http";
import { startInvestigation, type StartFailureCode } from "@/lib/labops/runs";
import { labopsStore, summarizeRun } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  supportRequestId: z.string().uuid(),
});

const statusForCode: Record<StartFailureCode, number> = {
  request_not_found: 404,
  request_ineligible: 422,
  limit_reached: 409,
  agent_unavailable: 502,
};

/** Investigation history. Any staff account may read it; only the operator may start one. */
export async function GET() {
  const gate = await guard("read_investigations");

  if (!gate.ok) {
    return gate.response;
  }

  try {
    const store = labopsStore();
    const runs = await store.listRuns();
    const usage = await Promise.all(runs.map((run) => store.runUsage(run.id)));

    return NextResponse.json({
      investigations: runs.map((run, index) => summarizeRun(run, usage[index])),
    });
  } catch (error) {
    return failureResponse(error, "Could not read investigation history.");
  }
}

/**
 * Starts an investigation from a support request. Owner-only, one at a time, and the
 * agent receives only the sanitized brief built from the ticket.
 */
export async function POST(request: NextRequest) {
  const gate = await guard("start_investigation");

  if (!gate.ok) {
    return gate.response;
  }

  const parsed = startSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(400, "A supportRequestId is required.", { code: "invalid_request" });
  }

  try {
    const result = await startInvestigation(runDeps(), {
      identity: gate.identity,
      supportRequestId: parsed.data.supportRequestId,
    });

    if (!result.ok) {
      return jsonError(statusForCode[result.code], result.reason, { code: result.code });
    }

    return NextResponse.json({ investigation: result.run }, { status: 201 });
  } catch (error) {
    return failureResponse(error, "Could not start the investigation.");
  }
}
