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
  runUsage(runId: string): Promise<UsageSnapshot>;
  nextEventSeq(runId: string): Promise<number>;
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
  getApproval(approvalId: string): Promise<ApprovalRow | null>;
  decideApproval(
    approvalId: string,
    decision: { status: "approved" | "rejected"; decidedBy: string; note?: string | null },
  ): Promise<ApprovalRow>;
  recordIntegrationHealth(
    integration: string,
    status: Database["public"]["Tables"]["ai_integration_health"]["Row"]["status"],
    detail?: string | null,
  ): Promise<void>;
};

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

    async nextEventSeq(runId) {
      const { data, error } = await client
        .from("ai_run_events")
        .select("seq")
        .eq("run_id", runId)
        .order("seq", { ascending: false })
        .limit(1);

      if (error) {
        throw new Error(`Could not read the investigation timeline: ${error.message}`);
      }

      return (data?.[0]?.seq ?? 0) + 1;
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
