import { NextResponse, type NextRequest } from "next/server";

import { parseVerifierProgress } from "@/lib/awx-progress";
import { recordVerifierProgress } from "@/lib/awx-progress-store";
import { readServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Push target for the AWX verifier playbooks: every verify run posts the family
 * it just graded here with the shared secret, so the portal holds its own copy
 * of the results instead of depending on the training tracker being reachable.
 * The browser never calls it, and the secret is only accepted in the
 * Authorization header — a verifier can send one, and a header keeps it out of
 * proxy and Vercel access logs.
 */
export async function POST(request: NextRequest) {
  const env = readServerEnv();
  const secret = env.AWX_PROGRESS_SECRET;
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseVerifierProgress(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await recordVerifierProgress(parsed.payload);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Verifier progress ingest failed.",
      },
      { status: 502 },
    );
  }
}
