import { NextResponse, type NextRequest } from "next/server";

import { captureCohortSnapshots } from "@/lib/cohort-progress";
import { readServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Copies the live training tracker into the active cohort's snapshot and
 * freezes the snapshot of any cohort whose access window has closed. Called on
 * a schedule with the shared secret (the hosting plan allows one Vercel cron a
 * day, so the frequent run comes from an external scheduler). The browser
 * never calls it.
 */
async function handle(request: NextRequest) {
  const env = readServerEnv();
  const secret = env.TRACKER_SNAPSHOT_SECRET ?? env.CRON_SECRET;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await captureCohortSnapshots();

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Cohort snapshot capture failed.",
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
