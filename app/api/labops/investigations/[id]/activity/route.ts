import type { NextRequest } from "next/server";

import { runDeps } from "@/lib/labops/gateway";
import { guard, jsonError, isUuid } from "@/lib/labops/http";
import { relayInvestigation } from "@/lib/labops/runs";

export const dynamic = "force-dynamic";

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Server-sent events relay for the investigation workspace.
 *
 * This is the only path agent activity takes to a browser: the gateway holds the
 * connection to the private agent server, and every frame here has already been
 * normalised and redacted. The stream also persists what it relays, so closing the tab
 * does not lose the timeline.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await guard("read_investigations");

  if (!gate.ok) {
    return gate.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError(404, "That investigation does not exist.", { code: "not_found" });
  }
  const deps = runDeps();
  const encoder = new TextEncoder();
  const controller = new AbortController();

  request.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      try {
        for await (const relayed of relayInvestigation(deps, {
          runId: id,
          signal: controller.signal,
        })) {
          sink.enqueue(encoder.encode(frame(relayed.type, relayed)));

          if (relayed.type === "end") {
            break;
          }
        }
      } catch {
        sink.enqueue(
          encoder.encode(
            frame("error", {
              type: "error",
              reason: "The activity relay stopped unexpectedly.",
              retryable: true,
            }),
          ),
        );
      } finally {
        controller.abort();
        sink.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
