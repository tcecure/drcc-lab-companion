import { describe, expect, it } from "vitest";

import { AgentClient, AgentServerError, workspaceDirForRun } from "@/lib/labops/agent";
import {
  buildCreateConversationBody,
  classifyHttpStatus,
  extractUsage,
  isRetryableFailure,
  isTerminalStatus,
  mapExecutionStatus,
  normalizeEvent,
  parseConversation,
  parseEventPage,
  retryDelayMs,
  runStatusForFailure,
} from "@/lib/labops/agent-protocol";

const llm = { model: "openai/gpt-5.5", apiKey: "sk-test-key-value-1234567890" };

type Call = { url: string; init: RequestInit };

function stubFetch(
  responses: Array<{ status?: number; body?: unknown; throws?: Error }>,
) {
  const calls: Call[] = [];
  let index = 0;

  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    if (next.throws) {
      throw next.throws;
    }

    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function client(responses: Parameters<typeof stubFetch>[0], maxRetries = 2) {
  const { impl, calls } = stubFetch(responses);

  return {
    calls,
    agent: new AgentClient({
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "agent-key",
      maxRetries,
      fetchImpl: impl,
      sleep: async () => {},
    }),
  };
}

describe("conversation request building", () => {
  const body = buildCreateConversationBody({
    workingDir: "workspace/investigations/run-1",
    initialMessage: "Investigate pod 03 connectivity",
    llm,
    maxIterations: 12,
    tags: { runid: "run-1" },
  });

  it("isolates the workspace and gates every action behind confirmation", () => {
    expect(body.workspace).toEqual({
      kind: "LocalWorkspace",
      working_dir: "workspace/investigations/run-1",
    });
    expect(body.confirmation_policy).toEqual({ kind: "AlwaysConfirm" });
    expect(body.max_iterations).toBe(12);
  });

  it("hands no secrets and no network tool to the workspace", () => {
    expect(body.secrets).toEqual({});
    expect(body.agent.tools.map((tool) => tool.name)).toEqual([
      "terminal",
      "file_editor",
      "task_tracker",
    ]);
  });

  it("keeps tag keys inside the agent server's lowercase-alphanumeric contract", () => {
    // Separators in a tag key are a 422 from the agent server, not a warning.
    for (const key of Object.keys(body.tags ?? {})) {
      expect(key).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("does not start the agent loop from the initial message", () => {
    expect(body.initial_message).toEqual({
      role: "user",
      content: [{ type: "text", text: "Investigate pod 03 connectivity" }],
      run: false,
    });
  });
});

describe("status mapping", () => {
  it("resolves the ambiguous idle status from whether work has started", () => {
    expect(mapExecutionStatus("idle")).toBe("queued");
    expect(mapExecutionStatus("idle", { started: true })).toBe("running");
  });

  it("maps confirmation to the approval workflow and stuck to failure", () => {
    expect(mapExecutionStatus("waiting_for_confirmation")).toBe("awaiting_approval");
    expect(mapExecutionStatus("stuck")).toBe("failed");
    expect(mapExecutionStatus("finished")).toBe("succeeded");
    expect(mapExecutionStatus("deleting")).toBe("cancelled");
  });

  it("classifies transport failures into run statuses", () => {
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(503)).toBe("unavailable");
    expect(classifyHttpStatus(401)).toBe("unauthorized");
    expect(runStatusForFailure("rate_limited")).toBe("rate_limited");
    expect(runStatusForFailure("unauthorized")).toBe("provider_error");
    expect(isRetryableFailure("unauthorized")).toBe(false);
    expect(isRetryableFailure("timeout")).toBe(true);
    expect(isTerminalStatus("awaiting_approval")).toBe(false);
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(retryDelayMs(3)).toBe(2_000);
  });
});

describe("conversation and usage parsing", () => {
  it("reads usage for the budget checks", () => {
    expect(
      extractUsage({
        model_name: "openai/gpt-5.5",
        accumulated_cost: 0.42,
        accumulated_token_usage: { prompt_tokens: 1_200, completion_tokens: 300 },
      }),
    ).toEqual({ promptTokens: 1_200, completionTokens: 300, costUsd: 0.42 });
  });

  it("reads usage from the per-usage-id stats the agent server actually reports", () => {
    // The pinned agent server leaves `metrics` null and reports spend under
    // stats.usage_to_metrics; reading only `metrics` made every run look free, which left
    // the token and spend caps unable to fire.
    const snapshot = parseConversation({
      id: "c1",
      execution_status: "waiting_for_confirmation",
      metrics: null,
      stats: {
        usage_to_metrics: {
          "labops-investigation": {
            model_name: "openai/gpt-5.5",
            accumulated_cost: 0.04848,
            accumulated_token_usage: { prompt_tokens: 7_734, completion_tokens: 327 },
          },
          condenser: {
            accumulated_cost: 0.01,
            accumulated_token_usage: { prompt_tokens: 100, completion_tokens: 10 },
          },
        },
      },
    });

    expect(snapshot.status).toBe("awaiting_approval");
    expect(snapshot.modelName).toBe("openai/gpt-5.5");
    expect(snapshot.usage.promptTokens).toBe(7_834);
    expect(snapshot.usage.completionTokens).toBe(337);
    expect(snapshot.usage.costUsd).toBeCloseTo(0.05848, 6);
  });

  it("tolerates a conversation with no metrics yet", () => {
    const snapshot = parseConversation({ id: "c1", execution_status: "running" });

    expect(snapshot.status).toBe("running");
    expect(snapshot.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    });
  });

  it("rejects a response without an id", () => {
    expect(() => parseConversation({ execution_status: "running" })).toThrow(/without an id/);
  });
});

describe("event normalisation", () => {
  it("redacts credentials that surface in agent output", () => {
    const event = normalizeEvent({
      id: "e1",
      kind: "ActionEvent",
      source: "agent",
      timestamp: "2026-08-25T00:00:00Z",
      action: { kind: "ExecuteBash", command: "curl -H 'Authorization: Bearer abcdef1234567890'" },
    });

    expect(event.redacted).toBe(true);
    expect(event.summary).not.toContain("abcdef1234567890");
    expect(event.toolName).toBe("ExecuteBash");
  });

  it("keeps the agent's own reply, which the server nests under llm_message", () => {
    // Shape taken from the pinned agent server's own OpenAPI schema: MessageEvent carries
    // no text of its own, so missing this key hid every conclusion the agent reached.
    const event = normalizeEvent({
      id: "e2",
      kind: "MessageEvent",
      source: "agent",
      timestamp: "2026-08-31T13:36:52Z",
      llm_message: {
        role: "assistant",
        content: [{ type: "text", text: "Pod01 logged no blocked connections because…" }],
      },
    });

    expect(event.summary).toBe("Pod01 logged no blocked connections because…");
    expect(event.redacted).toBe(false);
  });

  it("keeps an agent error and a refusal reason", () => {
    expect(normalizeEvent({ kind: "AgentErrorEvent", error: "tool call failed" }).summary).toBe(
      "tool call failed",
    );
    expect(
      normalizeEvent({ kind: "UserRejectObservation", rejection_reason: "not that host" }).summary,
    ).toBe("not that host");
  });

  it("returns a page with its cursor", () => {
    const page = parseEventPage({
      items: [{ id: "e1", kind: "MessageEvent", source: "agent", content: [{ text: "hello" }] }],
      next_page_id: "cursor-2",
    });

    expect(page.events[0].summary).toBe("hello");
    expect(page.nextPageId).toBe("cursor-2");
  });
});

describe("transport", () => {
  it("derives an isolated workspace per run and rejects a hostile id", () => {
    expect(workspaceDirForRun("run-1")).toBe("workspace/investigations/run-1");
    expect(workspaceDirForRun("../../etc/passwd")).toBe(
      "workspace/investigations/etcpasswd",
    );
    expect(() => workspaceDirForRun("../")).toThrow();
  });

  it("requires a server-side URL and key", () => {
    expect(() => new AgentClient({ baseUrl: "", apiKey: "" })).toThrow();
  });

  it("authenticates with the agent server's session key header", async () => {
    const { agent, calls } = client([{ body: { ok: true } }]);

    await agent.health();

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Session-API-Key"]).toBe("agent-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("treats an already-running conversation as a started one", async () => {
    // Creating a conversation with an initial message starts it, so 409 is the happy path.
    const { agent } = client([
      { status: 409, body: { detail: "Conversation already running." } },
    ]);

    await expect(agent.run("c1")).resolves.toBeUndefined();
  });

  it("still surfaces other start failures", async () => {
    const { agent } = client([{ status: 500, body: {} }]);

    await expect(agent.run("c1")).rejects.toBeInstanceOf(AgentServerError);
  });

  it("keeps the agent's api shape out of failure messages the operator reads", async () => {
    const { agent } = client([{ status: 500, body: {} }]);

    await agent.run("c1").catch((error: AgentServerError) => {
      expect(error.message).not.toContain("/api/conversations");
      expect(error.message).not.toContain("c1");
      expect(error.detail).toContain("/api/conversations");
    });
  });

  it("retries reads on transient failures and gives up with a typed error", async () => {
    const { agent, calls } = client([{ status: 503 }]);

    await expect(agent.getConversation("c1")).rejects.toMatchObject({
      name: "AgentServerError",
      code: "unavailable",
      retryable: true,
    });
    expect(calls).toHaveLength(3);
  });

  it("does not retry conversation creation", async () => {
    const { agent, calls } = client([{ status: 503 }]);

    await expect(
      agent.createConversation({
        workingDir: "workspace/investigations/run-1",
        initialMessage: "brief",
        llm,
      }),
    ).rejects.toBeInstanceOf(AgentServerError);
    expect(calls).toHaveLength(1);
  });

  it("reports an unhealthy agent server instead of throwing", async () => {
    const { agent } = client([{ status: 500 }]);

    await expect(agent.health()).resolves.toEqual({ ok: false });
  });

  it("treats an unauthorized response as permanent", async () => {
    const { agent, calls } = client([{ status: 401 }]);

    await expect(agent.getConversation("c1")).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("falls back to pause when stopping the goal fails", async () => {
    const { agent, calls } = client([
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { body: {} },
    ]);

    await expect(agent.cancel("c1")).resolves.toEqual({ stopped: false });
    expect(calls.at(-1)?.url).toContain("/pause");
  });

  it("treats a missing conversation as already cancelled", async () => {
    const { agent } = client([{ status: 404 }]);

    await expect(agent.cancel("c1")).resolves.toEqual({ stopped: true });
  });

  it("streams events then stops at a terminal status", async () => {
    const { agent } = client([
      {
        body: {
          items: [{ id: "e1", kind: "MessageEvent", source: "agent", content: [{ text: "working" }] }],
          next_page_id: null,
        },
      },
      { body: { id: "c1", execution_status: "finished" } },
    ]);

    const yielded: string[] = [];

    for await (const item of agent.streamActivity("c1", { pollIntervalMs: 0 })) {
      yielded.push(item.type);
    }

    expect(yielded).toEqual(["event", "status"]);
  });

  it("stops streaming when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const { agent, calls } = client([{ body: { items: [] } }]);

    for await (const _ of agent.streamActivity("c1", { signal: controller.signal })) {
      throw new Error("should not yield");
    }

    expect(calls).toHaveLength(0);
  });
});
