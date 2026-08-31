import "server-only";

/**
 * Persistence for LabOps AI investigations.
 *
 * Everything the gateway writes goes through here, with the service role, because the
 * ai_* tables have no insert/update policy for authenticated sessions. support_requests
 * is only ever read: the ticket stays the authoritative record and an investigation
 * carries a link back to it.
 *
 * The functions are grouped behind LabOpsStore so the orchestration in lib/labops/runs.ts
 * can be exercised with a stub in tests without a database.
 */

import type { AgentActivityEvent, AgentRunStatus } from "@/lib/labops/agent-protocol";
import { addUsage, zeroUsage, type UsageSnapshot } from "@/lib/labops/budgets";
import type {
  ConversationAttachmentMeta,
  SupportMessageRow,
} from "@/lib/labops/conversation";
import type { InvestigationBrief, SupportRequestRow } from "@/lib/labops/intake";
import { redactText } from "@/lib/labops/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/types";

export type RunRow = Database["public"]["Tables"]["ai_runs"]["Row"];
export type RunStatus = RunRow["status"];
export type ApprovalRow = Database["public"]["Tables"]["ai_approval_requests"]["Row"];

/** Statuses that hold the single active investigation slot. */
export const activeRunStatuses = [
  "queued",
  "running",
  "paused",
  "awaiting_approval",
] as const satisfies RunStatus[];

export function isActiveStatus(status: RunStatus) {
  return (activeRunStatuses as readonly RunStatus[]).includes(status);
}

export type CreateRunInput = {
  supportRequestId: string;
  requestedBy: string;
  title: string;
  brief: InvestigationBrief;
  model: string;
  provider: string;
  tokenBudget: number;
  wallclockLimitSeconds: number;
};

export type RunSummary = {
  id: string;
  supportRequestId: string;
  status: RunStatus;
  title: string;
  model: string;
  provider: string;
  findings: string | null;
  resolution: string | null;
  failureReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  usage: UsageSnapshot;
};

export type LabOpsStore = {
  listEligibleSupportRequests(limit?: number): Promise<SupportRequestRow[]>;
  getSupportRequest(id: string): Promise<SupportRequestRow | null>;
  /** Non-internal conversation plus attachment metadata; internal notes never leave. */
  getSupportConversation(supportRequestId: string): Promise<{
    messages: SupportMessageRow[];
    attachments: ConversationAttachmentMeta[];
    /** How many internal notes were left behind, counted without reading their bodies. */
    internalExcluded: number;
  }>;
  getPodLabel(labAssignmentId: string | null): Promise<string | null>;
  countActiveRuns(): Promise<number>;
  monthToDateCostUsd(now?: Date): Promise<number>;
  createRun(input: CreateRunInput): Promise<RunRow>;
  attachConversation(runId: string, conversationId: string): Promise<void>;
  markRunStarted(runId: string): Promise<void>;
  updateRunStatus(
    runId: string,
    status: RunStatus,
    patch?: { failureReason?: string | null; findings?: string | null; resolution?: string | null },
  ): Promise<void>;
  getRun(runId: string): Promise<RunRow | null>;
  listRuns(limit?: number): Promise<RunRow[]>;
  /** Runs the database still considers in flight, oldest first. */
  listActiveRuns(): Promise<RunRow[]>;
  /**
   * Records the container and volume an investigation was given, so a workspace found on
   * the host after a restart can be attributed to a run and reaped.
   */
  recordWorkspace(input: {
    runId: string;
    containerName: string;
    imageDigest: string;
    volumeName: string;
  }): Promise<void>;
  markWorkspaceDestroyed(
    runId: string,
    disposition?: "destroyed" | "archived",
  ): Promise<void>;
  runUsage(runId: string): Promise<UsageSnapshot>;
  /** Where a relay should resume from, so a reconnect never re-persists what it already has. */
  eventCursor(runId: string): Promise<RelayCursor>;
  listEvents(
    runId: string,
    limit?: number,
  ): Promise<Database["public"]["Tables"]["ai_run_events"]["Row"][]>;
  listMessages(
    runId: string,
    limit?: number,
  ): Promise<Database["public"]["Tables"]["ai_messages"]["Row"][]>;
  listToolActions(
    runId: string,
    limit?: number,
  ): Promise<Database["public"]["Tables"]["ai_tool_actions"]["Row"][]>;
  appendEvents(runId: string, events: readonly AgentActivityEvent[], firstSeq: number): Promise<void>;
  appendMessage(
    runId: string,
    role: Database["public"]["Tables"]["ai_messages"]["Row"]["role"],
    content: string,
  ): Promise<void>;
  recordToolAction(input: {
    runId: string;
    tool: string;
    target?: string | null;
    isWrite?: boolean;
    outcome: Database["public"]["Tables"]["ai_tool_actions"]["Row"]["outcome"];
    request?: Json;
    responseSummary?: string | null;
  }): Promise<void>;
  recordUsage(runId: string, provider: string, model: string, usage: UsageSnapshot): Promise<void>;
  listApprovals(runId: string): Promise<ApprovalRow[]>;
  /** Pending approvals across every investigation, for the LabOps approvals page. */
  listPendingApprovals(limit?: number): Promise<Array<ApprovalRow & { runTitle: string }>>;
  getApproval(approvalId: string): Promise<ApprovalRow | null>;
  decideApproval(
    approvalId: string,
    decision: { status: "approved" | "rejected"; decidedBy: string; note?: string | null },
  ): Promise<ApprovalRow>;
  /**
   * Whether a Phase 2 write path is enabled. Defaults to false, including when the
   * switch table does not exist yet, so an unmigrated database means "no writes".
   */
  isWriteEnabled(scope: string): Promise<boolean>;
  /**
   * Adds the reviewed findings as an internal system note on the ticket. Idempotent: a
   * second call for the same run is a no-op. Never touches status, priority or a
   * student-visible message.
   */
  publishFindingsNote(input: {
    runId: string;
    supportRequestId: string;
    body: string;
  }): Promise<{ created: boolean }>;
  recordIntegrationHealth(
    integration: string,
    status: Database["public"]["Tables"]["ai_integration_health"]["Row"]["status"],
    detail?: string | null,
  ): Promise<void>;
};

export type RelayCursor = {
  /** Next sequence number in the persisted timeline. */
  nextSeq: number;
  /** Timestamp of the newest persisted event, as the agent reported it. */
  since?: string;
  /** Agent event ids already persisted, because the timestamp bound is inclusive. */
  seenEventIds: string[];
};

export function relayCursorFromRows(
  rows: readonly { seq: number; payload: unknown }[],
): RelayCursor {
  const payloads = rows.map((row) => (row.payload ?? {}) as Record<string, unknown>);
  const timestamps = payloads
    .map((payload) => payload.timestamp)
    .filter((value): value is string => typeof value === "string");

  return {
    nextSeq: rows.reduce((highest, row) => Math.max(highest, row.seq), 0) + 1,
    since: timestamps.sort().at(-1),
    seenEventIds: payloads
      .map((payload) => payload.agentEventId)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  };
}

/**
 * The action a held run is waiting on, read from the persisted timeline. The relay never
 * re-sends an event it has already stored, so without this an operator who reloads the
 * page is asked to allow or refuse a step with nothing describing it.
 */
export function pendingStepSummary(
  rows: readonly { kind: string; payload: unknown }[],
): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];

    if (!/action/i.test(row.kind)) {
      continue;
    }

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const summary = typeof payload.summary === "string" ? payload.summary : null;
    const toolName = typeof payload.toolName === "string" ? payload.toolName : null;

    return summary ?? toolName ?? row.kind;
  }

  return null;
}

const investigableStatusList = ["open", "in_progress", "waiting_on_student"] as const;

function startOfMonthIso(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Only the run fields the browser is allowed to see; no agent id, no raw context. */
export function summarizeRun(run: RunRow, usage: UsageSnapshot = zeroUsage): RunSummary {
  return {
    id: run.id,
    supportRequestId: run.support_request_id,
    status: run.status,
    title: run.title,
    model: run.model,
    provider: run.provider,
    findings: run.findings,
    resolution: run.resolution,
    failureReason: run.failure_reason,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    usage,
  };
}

export function createLabOpsStore(
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
): LabOpsStore {
  const store: LabOpsStore = {
    async listEligibleSupportRequests(limit = 50) {
      const { data, error } = await client
        .from("support_requests")
        .select("*")
        .in("status", investigableStatusList)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read support requests: ${error.message}`);
      }

      return data ?? [];
    },

    async getSupportRequest(id) {
      const { data, error } = await client
        .from("support_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        throw new Error(`Could not read support request: ${error.message}`);
      }

      return data ?? null;
    },

    /**
     * Ordered non-internal messages plus attachment metadata. `is_internal` is filtered in
     * the query and again during intake, so a staff note cannot reach the model even if this
     * query is changed later.
     */
    async getSupportConversation(supportRequestId) {
      const { data: messages, error } = await client
        .from("support_messages")
        .select("*")
        .eq("support_request_id", supportRequestId)
        .eq("is_internal", false)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) {
        throw new Error(`Could not read the ticket conversation: ${error.message}`);
      }

      const { count } = await client
        .from("support_messages")
        .select("id", { count: "exact", head: true })
        .eq("support_request_id", supportRequestId)
        .eq("is_internal", true);
      const internalExcluded = count ?? 0;
      const messageIds = (messages ?? []).map((message) => message.id);

      if (messageIds.length === 0) {
        return { messages: [], attachments: [], internalExcluded };
      }

      // Metadata only: storage paths and signed URLs are never copied into a brief.
      const { data: attachments } = await client
        .from("support_attachments")
        .select("support_message_id, file_name, mime_type, size_bytes")
        .in("support_message_id", messageIds);

      return {
        messages: messages ?? [],
        internalExcluded,
        attachments: (attachments ?? []).map((attachment) => ({
          messageId: attachment.support_message_id,
          fileName: attachment.file_name,
          mimeType: attachment.mime_type,
          sizeBytes: attachment.size_bytes,
        })),
      };
    },

    /** Pod name only. The student's identity is deliberately never resolved here. */
    async getPodLabel(labAssignmentId) {
      if (!labAssignmentId) {
        return null;
      }

      const { data } = await client
        .from("lab_assignments")
        .select("lab_instances(pod_name)")
        .eq("id", labAssignmentId)
        .maybeSingle();

      const instance = data?.lab_instances as { pod_name?: string | null } | null | undefined;

      return instance?.pod_name?.trim() || null;
    },

    async countActiveRuns() {
      const { count, error } = await client
        .from("ai_runs")
        .select("id", { count: "exact", head: true })
        .in("status", activeRunStatuses);

      if (error) {
        throw new Error(`Could not count active investigations: ${error.message}`);
      }

      return count ?? 0;
    },

    async monthToDateCostUsd(now = new Date()) {
      const { data, error } = await client
        .from("ai_model_usage")
        .select("cost_usd")
        .gte("created_at", startOfMonthIso(now));

      if (error) {
        throw new Error(`Could not read model usage: ${error.message}`);
      }

      return Number(
        (data ?? []).reduce((total, row) => total + Number(row.cost_usd ?? 0), 0).toFixed(6),
      );
    },

    async createRun(input) {
      const { data, error } = await client
        .from("ai_runs")
        .insert({
          support_request_id: input.supportRequestId,
          requested_by: input.requestedBy,
          title: input.title,
          // Sanitized copy only: the brief has already been redacted and neutralized.
          sanitized_context: {
            category: input.brief.category,
            priority: input.brief.priority,
            podLabel: input.brief.podLabel,
            subject: input.brief.subject,
            description: input.brief.description,
            attachments: input.brief.attachmentSummary,
            conversation: input.brief.conversation
              ? {
                  entries: input.brief.conversation.entries,
                  internalExcluded: input.brief.conversation.internalExcluded,
                  droppedForBounds: input.brief.conversation.droppedForBounds,
                  deduplicatedDescription:
                    input.brief.conversation.deduplicatedDescription,
                }
              : null,
            freshness: input.brief.freshness,
            provenance: input.brief.provenance,
          } as unknown as Json,
          model: input.model,
          provider: input.provider,
          token_budget: input.tokenBudget,
          wallclock_limit_seconds: input.wallclockLimitSeconds,
        })
        .select("*")
        .single();

      if (error) {
        // 23505 is the single-active-run partial unique index.
        throw new Error(
          error.code === "23505"
            ? "An investigation is already active."
            : `Could not create the investigation: ${error.message}`,
        );
      }

      return data;
    },

    async attachConversation(runId, conversationId) {
      const { error } = await client
        .from("ai_runs")
        .update({ agent_conversation_id: conversationId })
        .eq("id", runId);

      if (error) {
        throw new Error(`Could not attach the agent conversation: ${error.message}`);
      }
    },

    async markRunStarted(runId) {
      const { error } = await client
        .from("ai_runs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", runId);

      if (error) {
        throw new Error(`Could not start the investigation: ${error.message}`);
      }
    },

    async updateRunStatus(runId, status, patch = {}) {
      const terminal = !isActiveStatus(status);
      const { error } = await client
        .from("ai_runs")
        .update({
          status,
          ...(patch.failureReason === undefined ? {} : { failure_reason: patch.failureReason }),
          ...(patch.findings === undefined ? {} : { findings: patch.findings }),
          ...(patch.resolution === undefined ? {} : { resolution: patch.resolution }),
          ...(terminal ? { ended_at: new Date().toISOString() } : {}),
        })
        .eq("id", runId);

      if (error) {
        throw new Error(`Could not update the investigation: ${error.message}`);
      }
    },

    async getRun(runId) {
      const { data, error } = await client
        .from("ai_runs")
        .select("*")
        .eq("id", runId)
        .maybeSingle();

      if (error) {
        throw new Error(`Could not read the investigation: ${error.message}`);
      }

      return data ?? null;
    },

    async listRuns(limit = 50) {
      const { data, error } = await client
        .from("ai_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read investigation history: ${error.message}`);
      }

      return data ?? [];
    },

    async listActiveRuns() {
      const { data, error } = await client
        .from("ai_runs")
        .select("*")
        .in("status", activeRunStatuses)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(`Could not read active investigations: ${error.message}`);
      }

      return data ?? [];
    },

    async recordWorkspace({ runId, containerName, imageDigest, volumeName }) {
      const { error } = await client.from("ai_run_workspaces").upsert(
        {
          run_id: runId,
          container_name: containerName,
          image_digest: imageDigest,
          volume_name: volumeName,
        },
        { onConflict: "run_id" },
      );

      if (error) {
        throw new Error(`Could not record the investigation workspace: ${error.message}`);
      }
    },

    /**
     * Destruction is recorded even when the row is missing (a workspace created before
     * this table existed, or reaped as an orphan), so the absence of a row never blocks
     * cleanup.
     */
    async markWorkspaceDestroyed(runId, disposition = "destroyed") {
      const { error } = await client
        .from("ai_run_workspaces")
        .update({ destroyed_at: new Date().toISOString(), disposition })
        .eq("run_id", runId)
        .is("destroyed_at", null);

      if (error) {
        throw new Error(`Could not record workspace destruction: ${error.message}`);
      }
    },

    async runUsage(runId) {
      const { data, error } = await client
        .from("ai_model_usage")
        .select("prompt_tokens, completion_tokens, cost_usd")
        .eq("run_id", runId);

      if (error) {
        throw new Error(`Could not read investigation usage: ${error.message}`);
      }

      return (data ?? []).reduce<UsageSnapshot>(
        (total, row) =>
          addUsage(total, {
            promptTokens: Number(row.prompt_tokens ?? 0),
            completionTokens: Number(row.completion_tokens ?? 0),
            costUsd: Number(row.cost_usd ?? 0),
          }),
        zeroUsage,
      );
    },

    async eventCursor(runId) {
      const { data, error } = await client
        .from("ai_run_events")
        .select("seq,payload")
        .eq("run_id", runId)
        .order("seq", { ascending: false })
        .limit(200);

      if (error) {
        throw new Error(`Could not read the investigation timeline: ${error.message}`);
      }

      return relayCursorFromRows(data ?? []);
    },

    async listEvents(runId, limit = 500) {
      const { data, error } = await client
        .from("ai_run_events")
        .select("*")
        .eq("run_id", runId)
        .order("seq", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read the investigation timeline: ${error.message}`);
      }

      return data ?? [];
    },

    async listMessages(runId, limit = 200) {
      const { data, error } = await client
        .from("ai_messages")
        .select("*")
        .eq("run_id", runId)
        .order("id", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read the investigation transcript: ${error.message}`);
      }

      return data ?? [];
    },

    async listToolActions(runId, limit = 200) {
      const { data, error } = await client
        .from("ai_tool_actions")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read the investigation audit trail: ${error.message}`);
      }

      return data ?? [];
    },

    async appendEvents(runId, events, firstSeq) {
      if (events.length === 0) {
        return;
      }

      const { error } = await client.from("ai_run_events").insert(
        events.map((event, index) => ({
          run_id: runId,
          seq: firstSeq + index,
          kind: event.kind,
          payload: {
            source: event.source,
            agentEventId: event.id,
            timestamp: event.timestamp,
            summary: event.summary,
            toolName: event.toolName,
            redacted: event.redacted,
          } as unknown as Json,
        })),
      );

      if (error) {
        throw new Error(`Could not append investigation events: ${error.message}`);
      }
    },

    async appendMessage(runId, role, content) {
      // Defence in depth: the brief is already sanitized, agent text already redacted.
      const { error } = await client
        .from("ai_messages")
        .insert({ run_id: runId, role, content: redactText(content).text });

      if (error) {
        throw new Error(`Could not append the transcript entry: ${error.message}`);
      }
    },

    async recordToolAction(input) {
      const { error } = await client.from("ai_tool_actions").insert({
        run_id: input.runId,
        tool: input.tool,
        target: input.target ?? null,
        is_write: input.isWrite ?? false,
        outcome: input.outcome,
        request: input.request ?? ({} as Json),
        response_summary:
          input.responseSummary === undefined || input.responseSummary === null
            ? null
            : redactText(input.responseSummary).text,
      });

      if (error) {
        throw new Error(`Could not record the tool action: ${error.message}`);
      }
    },

    async recordUsage(runId, provider, model, usage) {
      if (usage.promptTokens === 0 && usage.completionTokens === 0 && usage.costUsd === 0) {
        return;
      }

      const { error } = await client.from("ai_model_usage").insert({
        run_id: runId,
        provider,
        model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        cost_usd: usage.costUsd,
      });

      if (error) {
        throw new Error(`Could not record model usage: ${error.message}`);
      }
    },

    async listApprovals(runId) {
      const { data, error } = await client
        .from("ai_approval_requests")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(`Could not read approval requests: ${error.message}`);
      }

      return data ?? [];
    },

    /**
     * Pending approvals with only the investigation title alongside them. Approvers see the
     * sanitized action, never the support queue or the requester's identity.
     */
    async listPendingApprovals(limit = 50) {
      const { data, error } = await client
        .from("ai_approval_requests")
        .select("*, ai_runs(title)")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read approval requests: ${error.message}`);
      }

      return (data ?? []).map((row) => {
        const { ai_runs: run, ...approval } = row as ApprovalRow & {
          ai_runs: { title: string } | null;
        };

        return { ...approval, runTitle: run?.title ?? "Investigation" };
      });
    },

    async getApproval(approvalId) {
      const { data, error } = await client
        .from("ai_approval_requests")
        .select("*")
        .eq("id", approvalId)
        .maybeSingle();

      if (error) {
        throw new Error(`Could not read the approval request: ${error.message}`);
      }

      return data ?? null;
    },

    async decideApproval(approvalId, decision) {
      const { data, error } = await client
        .from("ai_approval_requests")
        .update({
          status: decision.status,
          decided_by: decision.decidedBy,
          decided_at: new Date().toISOString(),
          decision_note: decision.note ?? null,
        })
        .eq("id", approvalId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(
          error.code === "23514"
            ? "An approval cannot be decided by the account that requested it."
            : `Could not record the decision: ${error.message}`,
        );
      }

      if (!data) {
        throw new Error("That approval request is no longer pending.");
      }

      return data;
    },

    async isWriteEnabled(scope) {
      const { data, error } = await client
        .from("ai_write_switches")
        .select("scope, enabled")
        .in("scope", ["global", scope]);

      // The switch table arrives with the Phase 2 migration. Until then — and if the
      // read fails for any other reason — the answer is "not enabled".
      if (error || !data || data.length < 2) {
        return false;
      }

      return data.every((row) => row.enabled);
    },

    async publishFindingsNote({ runId, supportRequestId, body }) {
      const { data: existing } = await client
        .from("ai_findings_notes")
        .select("run_id")
        .eq("run_id", runId)
        .maybeSingle();

      if (existing) {
        return { created: false };
      }

      const { data: message, error: messageError } = await client
        .from("support_messages")
        .insert({
          support_request_id: supportRequestId,
          author_user_id: null,
          author_role: "system",
          body,
          is_internal: true,
        })
        .select("id")
        .single();

      if (messageError || !message) {
        throw new Error(
          `Could not add the internal findings note: ${messageError?.message ?? "unknown error"}`,
        );
      }

      const { error: linkError } = await client.from("ai_findings_notes").insert({
        run_id: runId,
        support_request_id: supportRequestId,
        support_message_id: message.id,
      });

      // A racing request already linked this run: the note it wrote is the one that
      // counts, so remove the duplicate this call created.
      if (linkError) {
        await client.from("support_messages").delete().eq("id", message.id);

        if (linkError.code === "23505" || linkError.code === "23514") {
          return { created: false };
        }

        throw new Error(`Could not link the findings note: ${linkError.message}`);
      }

      return { created: true };
    },

    async recordIntegrationHealth(integration, status, detail = null) {
      const { error } = await client.from("ai_integration_health").upsert(
        {
          integration,
          status,
          detail,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "integration" },
      );

      if (error) {
        throw new Error(`Could not record integration health: ${error.message}`);
      }
    },
  };

  return store;
}

let cached: LabOpsStore | null = null;

export function labopsStore() {
  if (!cached) {
    cached = createLabOpsStore();
  }

  return cached;
}

export type { AgentRunStatus };
