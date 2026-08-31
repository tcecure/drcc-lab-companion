import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { DirectChat, type ChatActivity, type ChatConversation } from "@/components/labops/chat";
import { requireManager } from "@/lib/auth";
import { authorizeLabOpsRequest } from "@/lib/labops/authz";
import { describeLabOpsConfig, isLabOpsConfigured } from "@/lib/labops/config";
import { isUuid } from "@/lib/labops/http";
import { labopsStore, pendingStepSummary } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

const historyPageSize = 15;

/** One persisted timeline row as the transcript's activity list shows it. */
function toActivity(row: {
  seq: number;
  kind: string;
  payload: unknown;
}): ChatActivity {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  return {
    id: `${row.seq}`,
    kind: row.kind,
    summary: typeof payload.summary === "string" ? payload.summary : null,
    toolName: typeof payload.toolName === "string" ? payload.toolName : null,
    redacted: payload.redacted === true,
  };
}

/**
 * Direct Chat. Owner-only for this release and enforced here as well as on every API
 * route the page calls: staff who may read investigations still cannot open this.
 */
export default async function LabOpsChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; page?: string }>;
}) {
  const { roles } = await requireManager();
  const operator = await authorizeLabOpsRequest("start_investigation");

  if (!operator.ok) {
    notFound();
  }

  if (!isLabOpsConfigured()) {
    return (
      <AppShell roles={roles} title="Ask LabOps AI">
        <Card eyebrow="Not configured" title="LabOps AI is not installed on this host">
          <p className="text-sm text-slate-300">
            The gateway needs its server-side configuration on the LabOps host before a
            conversation can start.
          </p>
        </Card>
      </AppShell>
    );
  }

  const { c, page: rawPage } = await searchParams;
  const page = Math.max(0, Number.parseInt(rawPage ?? "0", 10) || 0);
  const config = describeLabOpsConfig();
  const store = labopsStore();
  const { runs, hasMore } = await store.listRunPage({
    source: "direct",
    limit: historyPageSize,
    offset: page * historyPageSize,
  });

  let conversation: ChatConversation | null = null;

  if (c && isUuid(c)) {
    const run = await store.getRun(c);

    if (!run || run.source !== "direct") {
      notFound();
    }

    const [usage, messages, events] = await Promise.all([
      store.runUsage(run.id),
      store.listMessages(run.id),
      store.listEvents(run.id),
    ]);

    conversation = {
      id: run.id,
      title: run.title,
      status: run.status,
      createdAt: run.created_at,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      failureReason: run.failure_reason,
      usage,
      tokenBudget: run.token_budget,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
      })),
      activity: events.map(toActivity),
      pendingStep: pendingStepSummary(events),
    };
  }

  return (
    <AppShell roles={roles} title="Ask LabOps AI">
      <DirectChat
        conversation={conversation}
        hasMore={hasMore}
        history={runs.map((run) => ({
          id: run.id,
          title: run.title,
          status: run.status,
          createdAt: run.created_at,
        }))}
        limits={{
          runWallclockMinutes: config.limits.runWallclockMinutes,
          runCostBudgetUsd: config.limits.runCostBudgetUsd,
        }}
        page={page}
      />
    </AppShell>
  );
}
