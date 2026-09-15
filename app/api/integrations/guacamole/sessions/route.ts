import { NextResponse, type NextRequest } from "next/server";

import { readServerEnv } from "@/lib/env";
import { ingestGuacamoleSessions } from "@/lib/guacamole/ingest";
import { parseGuacamoleIngest } from "@/lib/guacamole/sessions";

export const dynamic = "force-dynamic";

/**
 * Ingest point for the lab-side Guacamole collector. Guacamole's database is
 * only reachable inside the lab network, so the collector reads it there and
 * posts session rows here with the shared secret. No Guacamole credential ever
 * reaches this application, and this route only accepts session state.
 */
export async function POST(request: NextRequest) {
  const env = readServerEnv();
  const secret = env.GUACAMOLE_INGEST_SECRET ?? env.CRON_SECRET;

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseGuacamoleIngest(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await ingestGuacamoleSessions(parsed.payload);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Guacamole session ingest failed.",
      },
      { status: 502 },
    );
  }
}
