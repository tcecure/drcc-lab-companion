import { NextResponse, type NextRequest } from "next/server";

import { readServerEnv } from "@/lib/env";
import { runActivityCollection } from "@/lib/moodle/activity-sync";
import { MoodleError } from "@/lib/moodle/client";

export const dynamic = "force-dynamic";

/**
 * Activity collection entry point for Live Operations. A scheduler calls this
 * every five minutes with the shared secret so the 15 minute window means
 * something; the browser never calls it and the Moodle token never leaves the
 * server. Reads only: the Moodle plugin behind it exposes no write function.
 */
async function handle(request: NextRequest) {
  const env = readServerEnv();
  const secret = env.MOODLE_SYNC_SECRET ?? env.CRON_SECRET;

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runActivityCollection();

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: error instanceof MoodleError ? error.code : "activity_failed",
        error:
          error instanceof MoodleError
            ? error.message
            : "Moodle activity collection failed.",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
