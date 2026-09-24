import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readServerEnv } from "@/lib/env";
import {
  listPendingRotations,
  markRotationPushed,
} from "@/lib/lab-credentials";

export const dynamic = "force-dynamic";

const acknowledgeSchema = z.object({
  seatNumbers: z.array(z.number().int().min(1).max(200)).min(1),
});

function authorized(request: NextRequest) {
  const env = readServerEnv();
  const secret = env.LAB_INTEGRATION_SECRET;
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  return Boolean(secret) && provided === secret;
}

/**
 * Pending rotations for the lab-side bridge. The plaintext password is returned
 * exactly once per push cycle, over TLS with a shared secret, because AWX has
 * to set it on the domain account and on the Guacamole connection. The secret
 * is never accepted in a query string, so it cannot land in an access log.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const rotations = await listPendingRotations();

    return NextResponse.json({
      ok: true,
      rotations: rotations.map((rotation) => ({
        labUsername: rotation.labUsername,
        password: rotation.password,
        podName: rotation.podName,
        seatNumber: rotation.seatNumber,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Pending rotations could not be read.",
      },
      { status: 500 },
    );
  }
}

/** Acknowledges seats whose password is now live in AD and Guacamole. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = acknowledgeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "seatNumbers must be a non-empty array of seat numbers." },
      { status: 400 },
    );
  }

  try {
    const applied = await markRotationPushed(parsed.data.seatNumbers);

    return NextResponse.json({ ok: true, applied });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Rotations could not be acknowledged.",
      },
      { status: 500 },
    );
  }
}
