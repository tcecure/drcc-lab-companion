import { NextResponse, type NextRequest } from "next/server";

import { readServerEnv } from "@/lib/env";
import { MoodleError } from "@/lib/moodle/client";
import { runMoodleSync, type SyncMode } from "@/lib/moodle/sync";

export const dynamic = "force-dynamic";

/**
 * Scheduled synchronization entry point. A scheduler calls this with the
 * shared secret: hourly with mode=incremental and once a day with mode=full.
 * The daily full run is a Vercel cron; the hourly incremental run comes from an
 * external scheduler because the hosting plan allows one cron per day. The
 * browser never calls it and the Moodle token never leaves the server.
 */
async function handle(request: NextRequest) {
  const env = readServerEnv();
  const secret = env.MOODLE_SYNC_SECRET ?? env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "MOODLE_SYNC_SECRET is not set." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const mode: SyncMode =
    request.nextUrl.searchParams.get("mode") === "incremental"
      ? "incremental"
      : "full";

  try {
    const result = await runMoodleSync(mode, "scheduled");

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: error instanceof MoodleError ? error.code : "sync_failed",
        error:
          error instanceof MoodleError
            ? error.message
            : "Moodle synchronization failed.",
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
