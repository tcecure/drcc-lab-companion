import { NextResponse, type NextRequest } from "next/server";

import { runCohortAssignment } from "@/lib/cohort-runner";
import { readServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Hourly cron entry point. Student numbers are handed out for a cohort once its
 * 01:00 America/New_York assignment time has passed, so running hourly keeps the
 * schedule correct across daylight-saving changes.
 */
async function handle(request: NextRequest) {
  const env = readServerEnv();

  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (provided !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runCohortAssignment();

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Assignment failed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
