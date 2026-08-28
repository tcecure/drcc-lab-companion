import { beforeEach, describe, expect, it } from "vitest";

import { AgentServerError } from "@/lib/labops/agent";
import type { AgentActivityEvent, ConversationSnapshot } from "@/lib/labops/agent-protocol";
import type { LabOpsLimits, UsageSnapshot } from "@/lib/labops/budgets";
import type { LabOpsIdentity } from "@/lib/labops/policy";
import {
  cancelInvestigation,
  recordResolution,
  relayInvestigation,
  startInvestigation,
  type AgentPort,
  type RelayFrame,
  type RunDeps,
} from "@/lib/labops/runs";
import type { LabOpsStore, RunRow, RunStatus } from "@/lib/labops/store";
import type { SupportRequestRow } from "@/lib/labops/intake";

const limits: LabOpsLimits = {
  runTokenBudget: 250_000,
  runCostBudgetUsd: 5,
  monthlyCostBudgetUsd: 150,
  runWallclockMinutes: 20,
  maxActiveRuns: 1,
};

const owner: LabOpsIdentity = {
  userId: "owner-user",
  email: "eddie@tcecure.com",
  roles: ["super_admin"],
};

function supportRequest(overrides: Partial<SupportRequestRow> = {}): SupportRequestRow {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    user_id: "student-user",
    lab_assignment_id: "assignment-1",
    category: "connectivity",
    subject: "Cannot reach the pod firewall",
    description: "Password is Hunter2Hunter2! and the LAN is unreachable.",
    priority: "high",
    status: "open",
    assigned_to: null,
    requester_name: "Student",
    requester_email: "student@example.edu",
    lab_family: "SC",
    pod_name: "Pod01",
    last_message_at: "2026-08-25T00:00:00.000Z",
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    support_request_id: supportRequest().id,
    requested_by: owner.userId,
    status: "queued",
    title: "Cannot reach the pod firewall (connectivity)",
    sanitized_context: {},
    agent_conversation_id: null,
    model: "openai/gpt-5.5",
    provider: "openai",
    token_budget: limits.runTokenBudget,
    wallclock_limit_seconds: limits.runWallclockMinutes * 60,
    failure_reason: null,
    findings: null,
    resolution: null,
    started_at: null,
    ended_at: null,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot(
  status: ConversationSnapshot["status"],
  usage: UsageSnapshot,
): ConversationSnapshot {
  return {
    id: "conv-1",
    status,
    executionStatus: status === "running" ? "running" : "finished",
    title: null,
    usage,
    modelName: "openai/gpt-5.5",
    leafEventId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function usage(promptTokens: number, completionTokens: number, costUsd: number): UsageSnapshot {
  return { promptTokens, completionTokens, costUsd };
}

type StubState = {
  request: SupportRequestRow | null;
  run: RunRow | null;
  activeRuns: number;
  monthCost: number;
  recordedUsage: UsageSnapshot;
  statusUpdates: Array<{ status: RunStatus; patch?: Record<string, unknown> }>;
  events: AgentActivityEvent[];
  messages: Array<{ role: string; content: string }>;
  toolActions: Array<{ tool: string; outcome: string }>;
  usageRows: Array<UsageSnapshot>;
};

function stubStore(state: StubState): LabOpsStore {
  return {
    async listEligibleSupportRequests() {
      return state.request ? [state.request] : [];
    },
    async getSupportRequest() {
      return state.request;
    },
    async getPodLabel() {
      return "Pod01";
    },
    async countActiveRuns() {
      return state.activeRuns;
    },
    async monthToDateCostUsd() {
      return state.monthCost;
    },
    async createRun(input) {
      state.run = runRow({ title: input.title, sanitized_context: { subject: input.brief.subject } });
      return state.run;
    },
    async attachConversation(_runId, conversationId) {
      state.run = { ...(state.run ?? runRow()), agent_conversation_id: conversationId };
    },
    async markRunStarted() {
      state.run = { ...(state.run ?? runRow()), status: "running", started_at: "2026-08-25T00:01:00.000Z" };
    },
    async updateRunStatus(_runId, status, patch) {
      state.statusUpdates.push({ status, patch });
      state.run = { ...(state.run ?? runRow()), status, failure_reason: patch?.failureReason ?? null };
    },
    async getRun() {
      return state.run;
    },
    async listRuns() {
      return state.run ? [state.run] : [];
    },
    async runUsage() {
      return state.recordedUsage;
    },
    async nextEventSeq() {
      return state.events.length + 1;
    },
    async listEvents() {
      return [];
    },
    async listMessages() {
      return [];
    },
    async listToolActions() {
      return [];
    },
    async appendEvents(_runId, events) {
      state.events.push(...events);
    },
    async appendMessage(_runId, role, content) {
      state.messages.push({ role, content });
    },
    async recordToolAction(input) {
      state.toolActions.push({ tool: input.tool, outcome: input.outcome });
    },
    async recordUsage(_runId, _provider, _model, recorded) {
      state.usageRows.push(recorded);
    },
    async listApprovals() {
      return [];
    },
    async getApproval() {
      return null;
    },
    async decideApproval() {
      throw new Error("not used");
    },
    async recordIntegrationHealth() {},
  };
}

function stubAgent(overrides: Partial<AgentPort> = {}): AgentPort {
  return {
    async createConversation() {
      return snapshot("running", usage(0, 0, 0));
    },
    async run() {},
    async cancel() {
      return { stopped: true };
    },
    async getConversation() {
      return snapshot("running", usage(0, 0, 0));
    },
    async *streamActivity() {},
    async health() {
      return { ok: true };
    },
    ...overrides,
  };
}

function deps(state: StubState, agent = stubAgent()): RunDeps {
  return {
    store: stubStore(state),
    agent,
    limits,
    provider: "openai",
    model: "openai/gpt-5.5",
    now: () => Date.parse("2026-08-25T00:02:00.000Z"),
  };
}

let state: StubState;

beforeEach(() => {
  state = {
    request: supportRequest(),
    run: null,
    activeRuns: 0,
    monthCost: 0,
    recordedUsage: usage(0, 0, 0),
    statusUpdates: [],
    events: [],
    messages: [],
    toolActions: [],
    usageRows: [],
  };
});

describe("starting an investigation", () => {
  it("sends only the sanitized brief to the agent and starts the run", async () => {
    const prompts: string[] = [];
    const agent = stubAgent({
      async createConversation(input) {
        prompts.push(input.initialMessage ?? "");
        expect(input.workingDir).toContain("run-1");
        for (const key of Object.keys(input.tags ?? {})) {
          expect(key).toMatch(/^[a-z0-9]+$/);
        }
        return snapshot("running", usage(0, 0, 0));
      },
    });

    const result = await startInvestigation(deps(state, agent), {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(result.ok).toBe(true);
    expect(prompts[0]).not.toContain("Hunter2Hunter2!");
    expect(prompts[0]).toContain("Pod01");
    expect(prompts[0]).not.toContain("student-user");
    expect(state.messages[0]?.role).toBe("user");
    expect(state.run?.status).toBe("running");
  });

  it("refuses a request that is not eligible", async () => {
    state.request = supportRequest({ status: "closed" });

    const result = await startInvestigation(deps(state), {
      identity: owner,
      supportRequestId: state.request.id,
    });

    expect(result).toMatchObject({ ok: false, code: "request_ineligible" });
  });

  it("refuses a second concurrent investigation", async () => {
    state.activeRuns = 1;

    const result = await startInvestigation(deps(state), {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(result).toMatchObject({ ok: false, code: "limit_reached" });
  });

  it("refuses to start once the monthly budget is spent", async () => {
    state.monthCost = limits.monthlyCostBudgetUsd;

    const result = await startInvestigation(deps(state), {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(result).toMatchObject({ ok: false, code: "limit_reached" });
  });

  it("reports a missing request rather than creating a run", async () => {
    state.request = null;

    const result = await startInvestigation(deps(state), {
      identity: owner,
      supportRequestId: "44444444-4444-4444-4444-444444444444",
    });

    expect(result).toMatchObject({ ok: false, code: "request_not_found" });
    expect(state.run).toBeNull();
  });

  it("ends the run when the agent server cannot be reached, freeing the active slot", async () => {
    const agent = stubAgent({
      async createConversation() {
        throw new AgentServerError("unavailable", "Agent server is unavailable.");
      },
    });

    const result = await startInvestigation(deps(state, agent), {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(result).toMatchObject({ ok: false, code: "agent_unavailable" });
    expect(state.statusUpdates.at(-1)?.status).toBe("provider_error");
    expect(state.toolActions.at(-1)).toMatchObject({ outcome: "failed" });
  });
});

describe("cancelling an investigation", () => {
  it("stops the agent and marks the run cancelled", async () => {
    state.run = runRow({ status: "running", agent_conversation_id: "conv-1" });
    let stopped = false;
    const agent = stubAgent({
      async cancel() {
        stopped = true;
        return { stopped: true };
      },
    });

    const result = await cancelInvestigation(deps(state, agent), {
      identity: owner,
      runId: "run-1",
    });

    expect(result.ok).toBe(true);
    expect(stopped).toBe(true);
    expect(state.statusUpdates.at(-1)?.status).toBe("cancelled");
  });

  it("still cancels when the agent refuses to stop", async () => {
    state.run = runRow({ status: "running", agent_conversation_id: "conv-1" });
    const agent = stubAgent({
      async cancel() {
        throw new AgentServerError("timeout", "Timed out.");
      },
    });

    const result = await cancelInvestigation(deps(state, agent), {
      identity: owner,
      runId: "run-1",
    });

    expect(result.ok).toBe(true);
    expect(state.statusUpdates.at(-1)?.status).toBe("cancelled");
  });

  it("rejects cancelling a finished investigation", async () => {
    state.run = runRow({ status: "succeeded" });

    const result = await cancelInvestigation(deps(state), { identity: owner, runId: "run-1" });

    expect(result).toMatchObject({ ok: false, code: "already_terminal" });
  });
});

async function collect(generator: AsyncGenerator<RelayFrame>) {
  const frames: RelayFrame[] = [];

  for await (const frame of generator) {
    frames.push(frame);
  }

  return frames;
}

describe("relaying activity", () => {
  const event: AgentActivityEvent = {
    id: "evt-1",
    kind: "action",
    source: "agent",
    timestamp: "2026-08-25T00:01:30.000Z",
    summary: "Read the pod firewall rules",
    toolName: "execute_bash",
    redacted: false,
  };

  it("persists events and usage and ends on a terminal status", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const agent = stubAgent({
      async *streamActivity() {
        yield { type: "event" as const, event };
        yield { type: "status" as const, snapshot: snapshot("succeeded", usage(1_000, 500, 0.25)) };
      },
    });

    const frames = await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    expect(frames.map((frame) => frame.type)).toEqual(["event", "status", "end"]);
    expect(state.events).toHaveLength(1);
    expect(state.usageRows).toEqual([usage(1_000, 500, 0.25)]);
    expect(state.statusUpdates.at(-1)?.status).toBe("succeeded");
  });

  it("gives a failed run a reason drawn from the agent's error event", async () => {
    // A provider rejection reaches the gateway only as an error event; without this the
    // operator sees a bare 'failed'.
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const agent = stubAgent({
      async *streamActivity() {
        yield {
          type: "event" as const,
          event: {
            ...event,
            id: "evt-err",
            kind: "ConversationErrorEvent",
            summary: "AuthenticationError: Incorrect API key provided",
          },
        };
        yield { type: "status" as const, snapshot: snapshot("failed", usage(0, 0, 0)) };
      },
    });

    await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    const last = state.statusUpdates.at(-1);

    expect(last?.status).toBe("failed");
    expect(last?.patch?.failureReason).toContain("Incorrect API key provided");
  });

  it("still explains a failure the agent reported nothing about", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const agent = stubAgent({
      async *streamActivity() {
        yield { type: "status" as const, snapshot: snapshot("failed", usage(0, 0, 0)) };
      },
    });

    await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    expect(state.statusUpdates.at(-1)?.patch?.failureReason).toMatch(/reported no error/);
  });

  it("cancels and records budget_exhausted when the run overspends", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });
    let cancelled = false;

    const agent = stubAgent({
      async cancel() {
        cancelled = true;
        return { stopped: true };
      },
      async *streamActivity() {
        yield {
          type: "status" as const,
          snapshot: snapshot("running", usage(400_000, 100_000, 9)),
        };
      },
    });

    const frames = await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    expect(cancelled).toBe(true);
    expect(frames.some((frame) => frame.type === "budget")).toBe(true);
    expect(state.statusUpdates.at(-1)?.status).toBe("budget_exhausted");
  });

  it("times the run out when the agent hits the wall-clock deadline", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const agent = stubAgent({
      async *streamActivity() {
        yield { type: "deadline" as const, snapshot: snapshot("running", usage(10, 10, 0.01)) };
      },
    });

    await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    expect(state.statusUpdates.at(-1)?.status).toBe("timed_out");
  });

  it("records only the delta against usage already stored", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });
    state.recordedUsage = usage(600, 300, 0.15);

    const agent = stubAgent({
      async *streamActivity() {
        yield { type: "status" as const, snapshot: snapshot("succeeded", usage(1_000, 500, 0.25)) };
      },
    });

    await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    expect(state.usageRows).toEqual([usage(400, 200, 0.1)]);
  });

  it("surfaces a rate limit as a non-retryable relay error and ends the run", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const agent = stubAgent({
      async *streamActivity(): AsyncGenerator<never> {
        throw new AgentServerError("rate_limited", "Rate limited.");
      },
    });

    const frames = await collect(relayInvestigation(deps(state, agent), { runId: "run-1" }));

    expect(frames[0]).toMatchObject({ type: "error" });
    expect(state.statusUpdates.at(-1)?.status).toBe("rate_limited");
  });

  it("reports a run that never reached the agent without streaming", async () => {
    state.run = runRow({ status: "failed" });

    const frames = await collect(relayInvestigation(deps(state), { runId: "run-1" }));

    expect(frames.map((frame) => frame.type)).toEqual(["status", "end"]);
  });
});

describe("recording a resolution", () => {
  it("stores findings and closes an active run as succeeded", async () => {
    state.run = runRow({ status: "running", agent_conversation_id: "conv-1" });

    const result = await recordResolution(deps(state), {
      runId: "run-1",
      findings: "LAN interface was removed",
      resolution: "Restored the pod firewall configuration backup",
    });

    expect(result.ok).toBe(true);
    expect(state.statusUpdates.at(-1)).toMatchObject({
      status: "succeeded",
      patch: { findings: "LAN interface was removed" },
    });
  });

  it("keeps a terminal status when annotating an old investigation", async () => {
    state.run = runRow({ status: "cancelled" });

    await recordResolution(deps(state), { runId: "run-1", findings: "Superseded" });

    expect(state.statusUpdates.at(-1)?.status).toBe("cancelled");
  });
});
