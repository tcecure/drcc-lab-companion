/**
 * Wire protocol for the private OpenHands Agent Server (pinned 1.42.1).
 *
 * Pure functions only: request building, status mapping, usage extraction and event
 * normalisation. The transport lives in lib/labops/agent.ts, which is server-only.
 * Keeping this half free of server-only imports lets the mapping be tested directly and
 * keeps the browser-visible shape of an event in one reviewable place.
 *
 * Only the endpoints listed in agentRoutes are ever called. The administrative surface
 * of the agent server (bash execution, plugins, secrets, profiles, /v1/chat/completions)
 * is deliberately not modelled here and is not reachable through the gateway.
 */

import { redactText } from "@/lib/labops/redact";
import type { UsageSnapshot } from "@/lib/labops/budgets";

export type AgentExecutionStatus =
  | "idle"
  | "running"
  | "paused"
  | "waiting_for_confirmation"
  | "finished"
  | "error"
  | "stuck"
  | "deleting";

/** Subset of public.ai_run_status the agent transport can produce. */
export type AgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rate_limited"
  | "provider_error";

export const agentRoutes = {
  health: "/health",
  ready: "/ready",
  createConversation: "/api/conversations",
  // Cheapest authenticated read: liveness alone cannot tell a good key from a bad one.
  conversationCount: "/api/conversations/count",
  conversation: (id: string) => `/api/conversations/${encodeURIComponent(id)}`,
  sendMessage: (id: string) =>
    `/api/conversations/${encodeURIComponent(id)}/events`,
  searchEvents: (id: string) =>
    `/api/conversations/${encodeURIComponent(id)}/events/search`,
  run: (id: string) => `/api/conversations/${encodeURIComponent(id)}/run`,
  stop: (id: string) =>
    `/api/conversations/${encodeURIComponent(id)}/goal/stop`,
  pause: (id: string) => `/api/conversations/${encodeURIComponent(id)}/pause`,
} as const;

export type LlmSettings = {
  model: string;
  apiKey: string;
  baseUrl?: string;
  requestTimeoutSeconds?: number;
  maxRetries?: number;
};

export type CreateConversationInput = {
  /** Isolated per-investigation working directory on the agent host. */
  workingDir: string;
  /** Already sanitised and redacted brief. Never raw ticket text. */
  initialMessage: string;
  llm: LlmSettings;
  conversationId?: string;
  maxIterations?: number;
  title?: string;
  /**
   * The agent server rejects any tag key outside /^[a-z0-9]+$/ with a 422, so keys carry
   * no separators: `runid`, not `run_id`.
   */
  tags?: Record<string, string>;
};

/**
 * Builds the POST /api/conversations body.
 *
 * Notes on the deliberate choices:
 * - `confirmation_policy: AlwaysConfirm` keeps every agent action gated, so the
 *   approval workflow — not the agent — decides whether anything runs.
 * - `secrets` is always empty: no lab or provider credential is ever handed to a
 *   workspace.
 * - the tool set excludes the browser, so a prompt injected into ticket text cannot
 *   reach the network from inside the workspace.
 */
export function buildCreateConversationBody(input: CreateConversationInput) {
  const {
    workingDir,
    initialMessage,
    llm,
    conversationId,
    maxIterations = 30,
    title,
    tags,
  } = input;

  return {
    workspace: { kind: "LocalWorkspace", working_dir: workingDir },
    ...(conversationId ? { conversation_id: conversationId } : {}),
    max_iterations: maxIterations,
    stuck_detection: true,
    confirmation_policy: { kind: "AlwaysConfirm" },
    secrets: {},
    ...(title ? { title } : {}),
    ...(tags ? { tags } : {}),
    initial_message: buildSendMessageBody(initialMessage, { run: false }),
    agent: {
      kind: "Agent",
      llm: {
        usage_id: "labops-investigation",
        model: llm.model,
        api_key: llm.apiKey,
        ...(llm.baseUrl ? { base_url: llm.baseUrl } : {}),
        ...(llm.requestTimeoutSeconds ? { timeout: llm.requestTimeoutSeconds } : {}),
        ...(llm.maxRetries === undefined ? {} : { num_retries: llm.maxRetries }),
      },
      // Registry names, not class names: 'TerminalTool' resolves to nothing and the agent
      // server fails initialization with KeyError once the first message is sent. The
      // browser tool set is deliberately absent — the workspace has no browser.
      tools: [
        { name: "terminal", params: {} },
        { name: "file_editor", params: {} },
        { name: "task_tracker", params: {} },
      ],
    },
  };
}

export function buildSendMessageBody(text: string, options: { run?: boolean } = {}) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
    run: options.run ?? true,
  };
}

/**
 * Maps the agent server's execution status onto the run status persisted in ai_runs.
 * `idle` is ambiguous on its own — before the first run it means queued, afterwards it
 * means the agent is waiting for input — so the caller passes whether work has started.
 */
export function mapExecutionStatus(
  status: AgentExecutionStatus,
  context: { started?: boolean } = {},
): AgentRunStatus {
  switch (status) {
    case "idle":
      return context.started ? "running" : "queued";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "waiting_for_confirmation":
      return "awaiting_approval";
    case "finished":
      return "succeeded";
    case "error":
    case "stuck":
      return "failed";
    case "deleting":
      return "cancelled";
  }
}

export type ConversationSnapshot = {
  id: string;
  status: AgentRunStatus;
  executionStatus: AgentExecutionStatus;
  title: string | null;
  usage: UsageSnapshot;
  modelName: string | null;
  leafEventId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type RawMetrics = {
  model_name?: unknown;
  accumulated_cost?: unknown;
  accumulated_token_usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  } | null;
};

function count(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? input : 0;
}

function text(input: unknown) {
  return typeof input === "string" && input.length > 0 ? input : null;
}

export function extractUsage(metrics: unknown): UsageSnapshot {
  const raw = (metrics ?? {}) as RawMetrics;
  const tokens = raw.accumulated_token_usage ?? {};

  return {
    promptTokens: count(tokens.prompt_tokens),
    completionTokens: count(tokens.completion_tokens),
    costUsd: count(raw.accumulated_cost),
  };
}

export function parseConversation(
  payload: unknown,
  context: { started?: boolean } = {},
): ConversationSnapshot {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const id = text(raw.id);

  if (!id) {
    throw new Error("Agent server returned a conversation without an id");
  }

  const executionStatus = (text(raw.execution_status) ?? "idle") as AgentExecutionStatus;
  const metrics = raw.metrics as RawMetrics | undefined;

  return {
    id,
    executionStatus,
    status: mapExecutionStatus(executionStatus, context),
    title: text(raw.title),
    usage: extractUsage(metrics),
    modelName: text(metrics?.model_name),
    leafEventId: text(raw.leaf_event_id),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
  };
}

/**
 * Browser-facing shape of an agent event. Free text is redacted on the way out: the
 * agent can read lab output, and nothing from inside the workspace is trusted to be
 * free of credentials.
 */
export type AgentActivityEvent = {
  id: string;
  kind: string;
  source: string;
  timestamp: string | null;
  /** Human-readable summary, redacted. Null for events with no displayable text. */
  summary: string | null;
  toolName: string | null;
  redacted: boolean;
};

function collectText(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectText(entry, depth + 1));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      "text",
      "content",
      "message",
      "thought",
      "output",
      "command",
      "reason",
      "action",
      "observation",
      "result",
    ]
      .filter((key) => key in record)
      .flatMap((key) => collectText(record[key], depth + 1));
  }

  return [];
}

export function normalizeEvent(
  payload: unknown,
  options: { maxSummaryLength?: number } = {},
): AgentActivityEvent {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const maxSummaryLength = options.maxSummaryLength ?? 2_000;
  const joined = collectText(raw).join("\n").slice(0, maxSummaryLength);
  const redaction = redactText(joined);
  const action = raw.action as Record<string, unknown> | undefined;

  return {
    id: text(raw.id) ?? "",
    kind: text(raw.kind) ?? "Event",
    source: text(raw.source) ?? "unknown",
    timestamp: text(raw.timestamp),
    summary: redaction.text || null,
    toolName: text(raw.tool_name) ?? text(action?.kind),
    redacted: redaction.redacted,
  };
}

export type AgentEventPage = {
  events: AgentActivityEvent[];
  nextPageId: string | null;
};

export function parseEventPage(payload: unknown): AgentEventPage {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(payload)
      ? (payload as unknown[])
      : [];

  return {
    events: items.map((item) => normalizeEvent(item)),
    nextPageId: text(raw.next_page_id),
  };
}

/** Terminal from the transport's point of view: no further polling is useful. */
export function isTerminalStatus(status: AgentRunStatus) {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "rate_limited" ||
    status === "provider_error"
  );
}

export type AgentFailureCode =
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_request"
  | "provider_error";

/** HTTP status → failure code, so the caller never has to read status numbers. */
export function classifyHttpStatus(status: number): AgentFailureCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status === 422 || status === 400) return "invalid_request";
  if (status >= 500) return "unavailable";
  return "provider_error";
}

export function runStatusForFailure(code: AgentFailureCode): AgentRunStatus {
  return code === "rate_limited" ? "rate_limited" : "provider_error";
}

/** Only transient transport failures are retried; nothing that could double-spend. */
export function isRetryableFailure(code: AgentFailureCode) {
  return code === "timeout" || code === "unavailable" || code === "rate_limited";
}

export function retryDelayMs(attempt: number, baseMs = 500, capMs = 8_000) {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}
