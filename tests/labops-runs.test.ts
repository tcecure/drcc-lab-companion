import { beforeEach, describe, expect, it } from "vitest";

import { AgentServerError } from "@/lib/labops/agent";
import type { AgentActivityEvent, ConversationSnapshot } from "@/lib/labops/agent-protocol";
import type { LabOpsLimits, UsageSnapshot } from "@/lib/labops/budgets";
import type { LabOpsIdentity } from "@/lib/labops/policy";
import {
  cancelInvestigation,
  decideAgentStep,
  publishReviewedFindings,
  recordResolution,
  enforceRunDeadlines,
  reconcileInvestigations,
  relayInvestigation,
  startInvestigation,
  type AgentPort,
  type RelayFrame,
  type RunDeps,
} from "@/lib/labops/runs";
import {
  pendingStepSummary,
  relayCursorFromRows,
  type LabOpsStore,
  type RunRow,
  type RunStatus,
} from "@/lib/labops/store";
import type { WorkspaceHandle, WorkspaceRuntime } from "@/lib/labops/workspace";
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
  messagesOnTicket?: Awaited<
    ReturnType<LabOpsStore["getSupportConversation"]>
  >["messages"];
  writeSwitches: Record<string, boolean>;
  findingsNotes: Array<{ runId: string; supportRequestId: string; body: string }>;
  /** Rows the gateway wrote to ai_run_workspaces, keyed by run. */
  workspaceRows: Array<{ runId: string; containerName: string; volumeName: string }>;
  destroyedWorkspaceRows: string[];
  otherActiveRuns: RunRow[];
};

function stubStore(state: StubState): LabOpsStore {
  return {
    async listEligibleSupportRequests() {
      return state.request ? [state.request] : [];
    },
    async getSupportRequest() {
      return state.request;
    },
    async getSupportConversation() {
      return {
        messages: (state.messagesOnTicket ?? []).filter((message) => !message.is_internal),
        attachments: [],
        internalExcluded: (state.messagesOnTicket ?? []).filter((message) => message.is_internal)
          .length,
      };
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
    async eventCursor() {
      return { nextSeq: state.events.length + 1, seenEventIds: [] };
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
    async listPendingApprovals() {
      return [];
    },
    async getApproval() {
      return null;
    },
    async decideApproval() {
      throw new Error("not used");
    },
    async isWriteEnabled(scope) {
      return state.writeSwitches[scope] === true;
    },
    async publishFindingsNote(input) {
      if (state.findingsNotes.some((note) => note.runId === input.runId)) {
        return { created: false };
      }

      state.findingsNotes.push(input);

      return { created: true };
    },
    async recordIntegrationHealth() {},
    async listActiveRuns() {
      const own = state.run && isActive(state.run.status) ? [state.run] : [];
      return [...own, ...state.otherActiveRuns];
    },
    async recordWorkspace(input) {
      state.workspaceRows.push({
        runId: input.runId,
        containerName: input.containerName,
        volumeName: input.volumeName,
      });
    },
    async markWorkspaceDestroyed(runId) {
      state.destroyedWorkspaceRows.push(runId);
    },
  };
}

function isActive(status: RunStatus) {
  return (
    status === "queued" ||
    status === "running" ||
    status === "paused" ||
    status === "awaiting_approval"
  );
}

type StubRuntime = WorkspaceRuntime & {
  started: string[];
  destroyed: string[];
  live: Map<string, WorkspaceHandle>;
};

/**
 * Stands in for run-investigation.sh. Each run gets its own container name, volume and
 * address, so a test can prove the gateway talks to the run's own workspace rather than a
 * shared one.
 */
function stubRuntime(overrides: Partial<WorkspaceRuntime> = {}): StubRuntime {
  const live = new Map<string, WorkspaceHandle>();
  const started: string[] = [];
  const destroyed: string[] = [];
  let nextHost = 10;

  const runtime: StubRuntime = {
    started,
    destroyed,
    live,
    async start(runId) {
      started.push(runId);
      nextHost += 1;

      const handle: WorkspaceHandle = {
        runId,
        containerName: `labops-inv-${runId}`,
        volumeName: `labops-inv-${runId}`,
        imageDigest: "ghcr.io/openhands/agent-server@sha256:pinned",
        endpoint: `172.31.241.${nextHost}:8000`,
        running: true,
      };

      live.set(runId, handle);

      return handle;
    },
    async inspect(runId) {
      return live.get(runId) ?? null;
    },
    async list() {
      return [...live.keys()];
    },
    async destroy(runId) {
      destroyed.push(runId);
      live.delete(runId);
    },
    ...overrides,
  };

  return runtime;
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
    async respondToConfirmation() {},
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

/**
 * Per-run runtime wiring, as gateway.ts assembles it: one container per investigation,
 * reached at the address the runtime reports, and a model base URL scoped to the run.
 */
function perRunDeps(
  state: StubState,
  options: {
    agentFor?: (handle: WorkspaceHandle) => AgentPort;
    runtime?: StubRuntime;
    now?: () => number;
  } = {},
): RunDeps & { runtime: StubRuntime; endpointsUsed: string[] } {
  const runtime = options.runtime ?? stubRuntime();
  const endpointsUsed: string[] = [];

  return {
    ...deps(state),
    ...(options.now ? { now: options.now } : {}),
    runtime,
    endpointsUsed,
    readyTimeoutMs: 1_000,
    agentFor: (handle) => {
      endpointsUsed.push(handle.endpoint);
      return options.agentFor?.(handle) ?? stubAgent();
    },
    llmFor: (runId) => ({
      model: "openai/gpt-5.5",
      apiKey: "proxy-token",
      baseUrl: `http://172.31.241.2:8081/r/${runId}/v1`,
    }),
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
    writeSwitches: {},
    findingsNotes: [],
    workspaceRows: [],
    destroyedWorkspaceRows: [],
    otherActiveRuns: [],
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

describe("deciding the step an agent is waiting on", () => {
  it("allows the pending action and resumes the run", async () => {
    state.run = runRow({ status: "awaiting_approval", agent_conversation_id: "conv-1" });
    const decisions: { accept: boolean; reason?: string }[] = [];
    const agent = stubAgent({
      async respondToConfirmation(_conversationId, input) {
        decisions.push(input);
      },
    });

    const result = await decideAgentStep(deps(state, agent), {
      identity: owner,
      runId: "run-1",
      accept: true,
    });

    expect(result.ok).toBe(true);
    expect(decisions).toEqual([{ accept: true }]);
    expect(state.statusUpdates.at(-1)?.status).toBe("running");
    expect(state.toolActions.at(-1)).toMatchObject({
      tool: "agent.action.allow",
      outcome: "allowed",
    });
  });

  it("sends a refusal reason back to the agent", async () => {
    state.run = runRow({ status: "awaiting_approval", agent_conversation_id: "conv-1" });
    const decisions: { accept: boolean; reason?: string }[] = [];
    const agent = stubAgent({
      async respondToConfirmation(_conversationId, input) {
        decisions.push(input);
      },
    });

    await decideAgentStep(deps(state, agent), {
      identity: owner,
      runId: "run-1",
      accept: false,
      reason: "Do not touch the gateway.",
    });

    expect(decisions).toEqual([{ accept: false, reason: "Do not touch the gateway." }]);
    expect(state.toolActions.at(-1)).toMatchObject({ tool: "agent.action.refuse" });
  });

  it("refuses to decide a run with no step waiting", async () => {
    state.run = runRow({ status: "running", agent_conversation_id: "conv-1" });

    const result = await decideAgentStep(deps(state), {
      identity: owner,
      runId: "run-1",
      accept: true,
    });

    expect(result).toMatchObject({ ok: false, code: "not_awaiting_approval" });
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

  it("refuses to conclude when the student replied after the investigation read the ticket", async () => {
    state.request = { ...supportRequest(), last_message_at: "2026-08-25T09:00:00.000Z" };
    state.run = runRow({
      status: "running",
      sanitized_context: {
        freshness: {
          lastMessageAt: "2026-08-25T08:00:00.000Z",
          includedMessageIds: ["msg-1"],
        },
      },
    });

    const result = await recordResolution(deps(state), {
      runId: "run-1",
      findings: "Answer based on the older ticket text",
    });

    expect(result).toMatchObject({ ok: false, code: "stale_context" });
    expect(state.statusUpdates).toHaveLength(0);
  });

  it("concludes anyway when the operator acknowledges the newer replies", async () => {
    state.request = { ...supportRequest(), last_message_at: "2026-08-25T09:00:00.000Z" };
    state.run = runRow({
      status: "running",
      sanitized_context: {
        freshness: {
          lastMessageAt: "2026-08-25T08:00:00.000Z",
          includedMessageIds: ["msg-1"],
        },
      },
    });

    const result = await recordResolution(deps(state), {
      runId: "run-1",
      findings: "Still valid",
      acknowledgeStaleContext: true,
    });

    expect(result).toMatchObject({ ok: true, stale: true });
    expect(state.statusUpdates.at(-1)?.status).toBe("succeeded");
  });
});

describe("filing findings on the ticket", () => {
  it("refuses while the support_notes write switch is off", async () => {
    state.run = runRow({ status: "succeeded", findings: "LAN rule ordering" });

    const result = await publishReviewedFindings(deps(state), {
      runId: "run-1",
      actorUserId: owner.userId,
    });

    expect(result).toMatchObject({ ok: false, code: "writes_disabled" });
    expect(state.findingsNotes).toHaveLength(0);
  });

  it("refuses when the investigation produced no findings", async () => {
    state.writeSwitches.support_notes = true;
    state.run = runRow({ status: "succeeded", findings: "   " });

    const result = await publishReviewedFindings(deps(state), {
      runId: "run-1",
      actorUserId: owner.userId,
    });

    expect(result).toMatchObject({ ok: false, code: "no_findings" });
    expect(state.findingsNotes).toHaveLength(0);
  });

  it("writes one internal note and never touches the ticket status", async () => {
    state.writeSwitches.support_notes = true;
    state.run = runRow({
      status: "succeeded",
      findings: "Pod01 LAN default deny sits above the DMZ rules.",
      resolution: "Move the deny to the bottom of the LAN tab.",
    });

    const first = await publishReviewedFindings(deps(state), {
      runId: "run-1",
      actorUserId: owner.userId,
    });
    const second = await publishReviewedFindings(deps(state), {
      runId: "run-1",
      actorUserId: owner.userId,
    });

    expect(first).toEqual({ ok: true, created: true });
    expect(second).toEqual({ ok: true, created: false });
    expect(state.findingsNotes).toHaveLength(1);
    expect(state.findingsNotes[0]?.body).toContain("[labops-run:run-1]");
    expect(state.statusUpdates).toHaveLength(0);
    expect(state.toolActions.map((action) => action.outcome)).toEqual([
      "succeeded",
      "denied",
    ]);
  });
});

describe("per-investigation containers", () => {
  const event: AgentActivityEvent = {
    id: "evt-1",
    kind: "action",
    source: "agent",
    timestamp: "2026-08-25T00:01:30.000Z",
    summary: "Read the pod firewall rules",
    toolName: "execute_bash",
    redacted: false,
  };

  it("launches a container for the run, records it, and uses its own address", async () => {
    const runtimeDeps = perRunDeps(state);

    const result = await startInvestigation(runtimeDeps, {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(result.ok).toBe(true);
    expect(runtimeDeps.runtime.started).toEqual(["run-1"]);
    expect(runtimeDeps.endpointsUsed).toEqual(["172.31.241.11:8000"]);
    expect(state.workspaceRows).toEqual([
      {
        runId: "run-1",
        containerName: "labops-inv-run-1",
        volumeName: "labops-inv-run-1",
      },
    ]);
    expect(state.toolActions.map((action) => action.tool)).toContain(
      "runtime.workspace.create",
    );
  });

  it("gives the container a model base URL scoped to its own run", async () => {
    const seen: Array<string | undefined> = [];
    const runtimeDeps = perRunDeps(state, {
      agentFor: () =>
        stubAgent({
          async createConversation(input) {
            seen.push(input.llm?.baseUrl);
            // The provider key is never handed to a container; the proxy holds it.
            expect(input.llm?.apiKey).toBe("proxy-token");
            return snapshot("running", usage(0, 0, 0));
          },
        }),
    });

    await startInvestigation(runtimeDeps, {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(seen).toEqual(["http://172.31.241.2:8081/r/run-1/v1"]);
  });

  it("destroys the workspace when the conversation cannot be created", async () => {
    const runtimeDeps = perRunDeps(state, {
      agentFor: () =>
        stubAgent({
          async createConversation() {
            throw new AgentServerError("unavailable", "Agent server is unreachable.");
          },
        }),
    });

    const result = await startInvestigation(runtimeDeps, {
      identity: owner,
      supportRequestId: state.request!.id,
    });

    expect(result.ok).toBe(false);
    expect(runtimeDeps.runtime.destroyed).toEqual(["run-1"]);
    expect(state.destroyedWorkspaceRows).toEqual(["run-1"]);
  });

  it("destroys the workspace when the run finishes", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    await runtime.start("run-1");

    const runtimeDeps = perRunDeps(state, {
      runtime,
      agentFor: () =>
        stubAgent({
          async *streamActivity() {
            yield { type: "event" as const, event };
            yield {
              type: "status" as const,
              snapshot: snapshot("succeeded", usage(10, 5, 0.01)),
            };
          },
        }),
    });

    await collect(relayInvestigation(runtimeDeps, { runId: "run-1" }));

    expect(runtimeDeps.runtime.destroyed).toEqual(["run-1"]);
    expect(state.destroyedWorkspaceRows).toEqual(["run-1"]);
  });

  it("destroys the workspace when a budget stops the run", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    await runtime.start("run-1");

    const runtimeDeps = perRunDeps(state, {
      runtime,
      agentFor: () =>
        stubAgent({
          async *streamActivity() {
            yield {
              type: "status" as const,
              snapshot: snapshot("running", usage(400_000, 0, 0)),
            };
          },
        }),
    });

    const frames = await collect(relayInvestigation(runtimeDeps, { runId: "run-1" }));

    expect(frames.some((frame) => frame.type === "budget")).toBe(true);
    expect(runtimeDeps.runtime.destroyed).toEqual(["run-1"]);
  });

  it("refuses to relay a run whose container is gone instead of using another one", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    // A different investigation is running; this run's own container is absent.
    await runtime.start("run-other");

    const runtimeDeps = perRunDeps(state, { runtime });
    const frames = await collect(relayInvestigation(runtimeDeps, { runId: "run-1" }));

    expect(frames[0]).toMatchObject({ type: "error" });
    expect(runtimeDeps.endpointsUsed).toEqual([]);
    expect(state.statusUpdates.at(-1)?.status).toBe("failed");
    expect(runtime.live.has("run-other")).toBe(true);
  });

  it("ends runs the database still calls active after a gateway restart", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    await runtime.start("run-1");

    const outcome = await reconcileInvestigations(perRunDeps(state, { runtime }));

    expect(outcome.endedRuns).toEqual(["run-1"]);
    expect(runtime.destroyed).toContain("run-1");
    expect(state.statusUpdates.at(-1)?.status).toBe("failed");
    expect(state.statusUpdates.at(-1)?.patch?.failureReason).toContain("restarted");
  });

  it("reaps a container left behind with no live run", async () => {
    state.run = null;

    const runtime = stubRuntime();
    await runtime.start("run-orphan");

    const outcome = await reconcileInvestigations(perRunDeps(state, { runtime }));

    expect(outcome.reapedWorkspaces).toEqual(["run-orphan"]);
    expect(runtime.live.size).toBe(0);
    // The audit tables are keyed to a run, so a container with none must not be recorded:
    // the insert would fail and abandon the cleanup.
    expect(state.toolActions).toEqual([]);
    expect(state.destroyedWorkspaceRows).toEqual([]);
  });

  it("ends a run that outlives its wall-clock limit with nobody watching the relay", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    await runtime.start("run-1");

    const outcome = await enforceRunDeadlines(
      perRunDeps(state, {
        runtime,
        // 21 minutes after the run started; the limit is 20.
        now: () => Date.parse("2026-08-25T00:22:00.000Z"),
      }),
    );

    expect(outcome.endedRuns).toEqual(["run-1"]);
    expect(state.statusUpdates.at(-1)?.status).toBe("timed_out");
    expect(runtime.destroyed).toContain("run-1");
  });

  it("leaves a run inside its limit alone", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    await runtime.start("run-1");

    const outcome = await enforceRunDeadlines(perRunDeps(state, { runtime }));

    expect(outcome).toEqual({ endedRuns: [], reapedWorkspaces: [] });
    expect(runtime.live.has("run-1")).toBe(true);
  });

  it("records a cleanup failure instead of losing it", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime({
      async destroy() {
        throw new Error("docker daemon is not responding");
      },
    });
    await runtime.start("run-1");

    await cancelInvestigation(perRunDeps(state, { runtime }), {
      identity: owner,
      runId: "run-1",
    });

    const cleanup = state.toolActions.filter(
      (action) => action.tool === "runtime.workspace.destroy",
    );

    expect(cleanup).toEqual([{ tool: "runtime.workspace.destroy", outcome: "failed" }]);
  });

  it("destroys the workspace when the owner cancels", async () => {
    state.run = runRow({
      status: "running",
      agent_conversation_id: "conv-1",
      started_at: "2026-08-25T00:01:00.000Z",
    });

    const runtime = stubRuntime();
    await runtime.start("run-1");

    const result = await cancelInvestigation(perRunDeps(state, { runtime }), {
      identity: owner,
      runId: "run-1",
    });

    expect(result.ok).toBe(true);
    expect(runtime.destroyed).toEqual(["run-1"]);
    expect(state.destroyedWorkspaceRows).toEqual(["run-1"]);
  });
});

describe("resuming a relay and describing a held step", () => {
  it("resumes from the persisted timeline instead of replaying it", () => {
    const cursor = relayCursorFromRows([
      {
        seq: 2,
        payload: { agentEventId: "evt-2", timestamp: "2026-08-31T10:51:23.536Z" },
      },
      {
        seq: 1,
        payload: { agentEventId: "evt-1", timestamp: "2026-08-31T10:51:18.945Z" },
      },
    ]);

    expect(cursor.nextSeq).toBe(3);
    expect(cursor.since).toBe("2026-08-31T10:51:23.536Z");
    // The agent's timestamp bound is inclusive, so the ids are what stops a duplicate.
    expect(cursor.seenEventIds).toEqual(["evt-2", "evt-1"]);
  });

  it("reads the held action out of the persisted timeline", () => {
    // The relay never re-sends a stored event, so an operator who reloads the page would
    // otherwise be asked to allow or refuse a step with nothing describing it.
    expect(
      pendingStepSummary([
        { kind: "ActionEvent", payload: { summary: "Run `ip addr show` on pod03-gw" } },
        { kind: "ConversationStateUpdateEvent", payload: { summary: "waiting_for_confirmation" } },
      ]),
    ).toBe("Run `ip addr show` on pod03-gw");

    expect(pendingStepSummary([{ kind: "MessageEvent", payload: { summary: "hello" } }])).toBeNull();
    expect(pendingStepSummary([{ kind: "ActionEvent", payload: { toolName: "terminal" } }])).toBe(
      "terminal",
    );
  });
});
