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
      "TerminalTool",
      "FileEditorTool",
      "TaskTrackerTool",
    ]);
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
