import "server-only";

/**
 * Shared response helpers for the LabOps AI gateway routes.
 *
 * Errors are deliberately terse: the private agent URL, the agent key and the provider
 * key must never reach a response body, and internal messages are only logged when they
 * carry no ticket content.
 */

import { NextResponse } from "next/server";

import { authorizeLabOpsRequest } from "@/lib/labops/authz";
import { isLabOpsConfigured } from "@/lib/labops/config";
import type { LabOpsCapability } from "@/lib/labops/policy";

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

// Any UUID shape Postgres stores happily: zod's .uuid() enforces the RFC 4122 variant
// nibble, which rejects hand-seeded ids.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path ids reach the database as `uuid`, where a malformed value raises a cast error and
 * would surface as a 500. Callers reject the shape first and report "not found" instead.
 */
export function isUuid(value: string) {
  return uuidPattern.test(value);
}

/**
 * Every LabOps route starts here: session, staff role, and the pilot-operator gate for
 * anything that spends money. A missing server configuration is reported as 503 rather
 * than crashing the route, so the UI can explain what the owner still has to install.
 */
export async function guard(capability: LabOpsCapability) {
  if (!isLabOpsConfigured()) {
    return {
      ok: false as const,
      response: jsonError(503, "LabOps AI is not configured on this host yet.", {
        code: "not_configured",
      }),
    };
  }

  const decision = await authorizeLabOpsRequest(capability);

  if (!decision.ok) {
    return {
      ok: false as const,
      response: jsonError(decision.failure.status, decision.failure.reason, {
        code: decision.failure.status === 401 ? "unauthenticated" : "forbidden",
      }),
    };
  }

  return { ok: true as const, identity: decision.identity };
}

/** Maps a thrown store/orchestration error onto a response without leaking internals. */
export function failureResponse(error: unknown, fallback = "The gateway request failed.") {
  const message = error instanceof Error ? error.message : fallback;

  if (/already active/i.test(message)) {
    return jsonError(409, message, { code: "active_run_exists" });
  }

  if (/no longer pending|cannot be decided/i.test(message)) {
    return jsonError(409, message, { code: "conflict" });
  }

  return jsonError(500, fallback, { code: "gateway_error" });
}
