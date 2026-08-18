import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  checkedAt: z.string().datetime().optional(),
  source: z.string().max(64).optional(),
  nodes: z
    .array(
      z.object({
        node: z.string().min(1),
        status: z.string().optional(),
      }),
    )
    .max(64),
  resources: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        node: z.string().optional(),
        status: z.string().optional(),
        type: z.string().optional(),
        vmid: z.number().int().optional(),
      }),
    )
    .max(2_000),
});

/**
 * Ingestion endpoint for the internal lab poller. The poller holds the
 * read-only Proxmox token inside the lab network and posts a normalized
 * snapshot here every 30-60 seconds, so the Proxmox management interface never
 * has to be exposed to the internet or to Vercel.
 */
export async function POST(request: NextRequest) {
  const env = readServerEnv();

  if (!env.LAB_STATUS_INGEST_SECRET) {
    return NextResponse.json(
      { error: "LAB_STATUS_INGEST_SECRET is not set." },
      { status: 503 },
    );
  }

  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (provided !== env.LAB_STATUS_INGEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid snapshot payload." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("lab_status_snapshots").insert({
    checked_at: parsed.data.checkedAt ?? new Date().toISOString(),
    nodes: parsed.data.nodes,
    resources: parsed.data.resources,
    source: parsed.data.source ?? "internal-poller",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    nodes: parsed.data.nodes.length,
    ok: true,
    resources: parsed.data.resources.length,
  });
}
