import { NextResponse } from "next/server";

import { guard, failureResponse } from "@/lib/labops/http";
import { evaluateEligibility } from "@/lib/labops/intake";
import { labopsStore } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

/**
 * Support requests the operator may open an investigation against. Phase 1's only intake
 * source. The listing carries no student identity: the pod is resolved when an
 * investigation actually starts, and the ticket body is not sanitized here because it is
 * shown to staff, not sent to a model.
 */
export async function GET() {
  const gate = await guard("read_investigations");

  if (!gate.ok) {
    return gate.response;
  }

  try {
    const requests = await labopsStore().listEligibleSupportRequests();

    return NextResponse.json({
      requests: requests.map((request) => {
        const eligibility = evaluateEligibility(request);

        return {
          id: request.id,
          category: request.category,
          priority: request.priority,
          status: request.status,
          subject: request.subject,
          description: request.description,
          createdAt: request.created_at,
          updatedAt: request.updated_at,
          eligible: eligibility.eligible,
          ineligibleReason: eligibility.eligible ? null : eligibility.reason,
        };
      }),
    });
  } catch (error) {
    return failureResponse(error, "Could not list support requests.");
  }
}
