import "server-only";

/**
 * Transport for the private OpenHands Agent Server on drcc-labops-01.
 *
 * Invariants this module exists to keep:
 * - the agent server is reachable only from the gateway process (loopback), so its URL
 *   and bearer key stay server-side and are never returned by an API route;
 * - the browser never speaks to the agent server: activity reaches the UI only as
 *   normalised, redacted events relayed by the gateway;
 * - only the endpoints in agentRoutes are called — the stock OpenHands UI and the
 *   administrative routes (bash, plugins, secrets, profiles) are never proxied;
 * - every request has a timeout, and only transient failures are retried, so a stalled
 *   provider cannot hold an investigation open past its wall-clock budget.
 */

import { readLabOpsConfig, type LabOpsConfig } from "@/lib/labops/config";
import {
  agentRoutes,
  buildCreateConversationBody,
  buildSendMessageBody,
  classifyHttpStatus,
  isRetryableFailure,
  parseConversation,
  parseEventPage,
  retryDelayMs,
  type AgentEventPage,
  type AgentFailureCode,
  type ConversationSnapshot,
  type CreateConversationInput,
} from "@/lib/labops/agent-protocol";

export class AgentServerError extends Error {
  readonly code: AgentFailureCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(
    code: AgentFailureCode,
    message: string,
    options: { httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = "AgentServerError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = isRetryableFailure(code);
  }
}

export type AgentClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Safe to repeat. Only set for reads and idempotent controls. */
  retryable?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Per-investigation workspace, so no two runs can see each other's files. */
export function workspaceDirForRun(runId: string) {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "");

  if (!safe) {
    throw new Error("A run id is required to derive an isolated workspace");
  }

  return `workspace/investigations/${safe}`;
}

export class AgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly config: LabOpsConfig | null;

  constructor(options: AgentClientOptions & { config?: LabOpsConfig } = {}) {
    const config = options.config ?? null;

    this.config = config;
    this.baseUrl = (
      options.baseUrl ??
      config?.LABOPS_AGENT_SERVER_URL ??
      ""
    ).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? config?.LABOPS_AGENT_SERVER_API_KEY ?? "";
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? (config?.LABOPS_LLM_REQUEST_TIMEOUT_S ?? 120) * 1_000;
    this.maxRetries = options.maxRetries ?? config?.LABOPS_LLM_MAX_RETRIES ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;

    if (!this.baseUrl || !this.apiKey) {
      throw new Error(
        "Agent server URL and API key are required (LABOPS_AGENT_SERVER_URL, LABOPS_AGENT_SERVER_API_KEY)",
      );
    }
  }

  private url(path: string, query?: RequestOptions["query"]) {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const attempts = options.retryable ? this.maxRetries + 1 : 1;
    let lastError: AgentServerError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.attempt<T>(path, options);
      } catch (error) {
        if (!(error instanceof AgentServerError) || !error.retryable) {
          throw error;
        }

        lastError = error;

        if (attempt < attempts) {
          await this.sleep(retryDelayMs(attempt));
        }
      }
    }

    throw (
      lastError ??
      new AgentServerError("provider_error", "Agent server request failed")
    );
  }

  private async attempt<T>(path: string, options: RequestOptions): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();

    options.signal?.addEventListener("abort", abort);

    let response: Response;

    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method: options.method ?? "GET",
        headers: {
          // The agent server authenticates SESSION_API_KEY through its APIKeyHeader
          // scheme; its bearer scheme is for a different credential and rejects this key.
          "X-Session-API-Key": this.apiKey,
          Accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      // Deliberately does not include the request body: it can carry the provider key.
      if (options.signal?.aborted) {
        throw new AgentServerError("timeout", "Agent server request was cancelled");
      }

      const aborted = error instanceof Error && error.name === "AbortError";

      throw new AgentServerError(
        aborted ? "timeout" : "unavailable",
        aborted
          ? `Agent server did not respond within ${Math.round(timeoutMs / 1_000)}s`
          : "Agent server is unreachable",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }

    if (!response.ok) {
      const code = classifyHttpStatus(response.status);

      throw new AgentServerError(
        code,
        `Agent server returned ${response.status} for ${path}`,
        { httpStatus: response.status },
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new AgentServerError(
        "provider_error",
        `Agent server returned an unreadable response for ${path}`,
        { httpStatus: response.status },
      );
    }
  }

  /**
   * Liveness *and* credentials: the unauthenticated /health endpoint answers even when the
   * gateway's key is wrong, which would report a healthy agent right up to the first start.
   * Never exposes the agent URL to callers.
   */
  async health(): Promise<{ ok: boolean }> {
    try {
      await this.request<unknown>(agentRoutes.health, {
        retryable: true,
        timeoutMs: 5_000,
      });
      await this.request<unknown>(agentRoutes.conversationCount, {
        retryable: true,
        timeoutMs: 5_000,
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Creates an isolated conversation for one investigation. The brief must already be
   * sanitised (lib/labops/sanitize) — this method does not clean ticket text.
   */
  async createConversation(
    input: Omit<CreateConversationInput, "llm"> & {
      llm?: CreateConversationInput["llm"];
    },
  ): Promise<ConversationSnapshot> {
    const llm = input.llm ?? this.llmFromConfig();
    const payload = await this.request<unknown>(agentRoutes.createConversation, {
      method: "POST",
      body: buildCreateConversationBody({ ...input, llm }),
    });

    return parseConversation(payload);
  }

  private llmFromConfig(): CreateConversationInput["llm"] {
    const config = this.config ?? readLabOpsConfig();

    return {
      model: config.LABOPS_LLM_MODEL,
      apiKey: config.LABOPS_LLM_API_KEY,
      baseUrl: config.LABOPS_LLM_BASE_URL,
      requestTimeoutSeconds: config.LABOPS_LLM_REQUEST_TIMEOUT_S,
      maxRetries: config.LABOPS_LLM_MAX_RETRIES,
    };
  }

  async getConversation(
    conversationId: string,
    context: { started?: boolean } = {},
  ): Promise<ConversationSnapshot> {
    const payload = await this.request<unknown>(
      agentRoutes.conversation(conversationId),
      { retryable: true },
    );

    return parseConversation(payload, context);
  }

  /** Sends an already-sanitised follow-up message and lets the agent loop continue. */
  async sendMessage(
    conversationId: string,
    text: string,
    options: { run?: boolean } = {},
  ): Promise<void> {
    await this.request<unknown>(agentRoutes.sendMessage(conversationId), {
      method: "POST",
      body: buildSendMessageBody(text, options),
    });
  }

  async run(conversationId: string): Promise<void> {
    await this.request<unknown>(agentRoutes.run(conversationId), { method: "POST" });
  }

  async pause(conversationId: string): Promise<void> {
    await this.request<unknown>(agentRoutes.pause(conversationId), {
      method: "POST",
      retryable: true,
    });
  }

  /**
   * Cancellation. Stopping the goal is the graceful path; pause is the fallback so a
   * run cannot keep spending after the operator has cancelled it. Deleting the
   * conversation is left to retention, so the audit trail survives a cancellation.
   */
  async cancel(conversationId: string): Promise<{ stopped: boolean }> {
    try {
      await this.request<unknown>(agentRoutes.stop(conversationId), {
        method: "POST",
        retryable: true,
        timeoutMs: 15_000,
      });
      return { stopped: true };
    } catch (error) {
      if (error instanceof AgentServerError && error.code === "not_found") {
        return { stopped: true };
      }

      await this.pause(conversationId);
      return { stopped: false };
    }
  }

  async listEvents(
    conversationId: string,
    options: { pageId?: string; limit?: number; signal?: AbortSignal } = {},
  ): Promise<AgentEventPage> {
    const payload = await this.request<unknown>(
      agentRoutes.searchEvents(conversationId),
      {
        retryable: true,
        signal: options.signal,
        query: {
          page_id: options.pageId,
          limit: options.limit ?? 100,
          sort_order: "TIMESTAMP",
        },
      },
    );

    return parseEventPage(payload);
  }

  /**
   * Relay source for the gateway's SSE route: yields normalised, redacted events as the
   * agent produces them and stops when the conversation reaches a terminal state, the
   * deadline passes, or the caller aborts. Polling rather than the agent server's
   * websocket keeps one code path for both, and the gateway remains the only thing that
   * ever holds a connection to the agent.
   */
  async *streamActivity(
    conversationId: string,
    options: {
      pageId?: string;
      pollIntervalMs?: number;
      deadlineMs?: number;
      signal?: AbortSignal;
      now?: () => number;
    } = {},
  ) {
    const pollIntervalMs = options.pollIntervalMs ?? 1_500;
    const now = options.now ?? Date.now;
    const startedAt = now();
    let pageId = options.pageId;
    let started = false;

    while (!options.signal?.aborted) {
      const page = await this.listEvents(conversationId, {
        pageId,
        signal: options.signal,
      });

      if (page.events.length > 0) {
        started = true;

        for (const event of page.events) {
          yield { type: "event" as const, event };
        }
      }

      if (page.nextPageId) {
        pageId = page.nextPageId;
        continue;
      }

      const snapshot = await this.getConversation(conversationId, { started });

      yield { type: "status" as const, snapshot };

      if (
        snapshot.status === "succeeded" ||
        snapshot.status === "failed" ||
        snapshot.status === "cancelled" ||
        snapshot.status === "awaiting_approval"
      ) {
        return;
      }

      if (options.deadlineMs !== undefined && now() - startedAt >= options.deadlineMs) {
        yield { type: "deadline" as const, snapshot };
        return;
      }

      await this.sleep(pollIntervalMs);
    }
  }
}

let cached: AgentClient | null = null;

/** Process-wide client built from server-side configuration. */
export function agentClient() {
  if (!cached) {
    cached = new AgentClient({ config: readLabOpsConfig() });
  }

  return cached;
}
