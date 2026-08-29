/**
 * Investigation orchestration for the LabOps AI gateway.
 *
 * Route handlers stay thin: they authorize, parse, and hand over to these functions.
 * Everything here takes its dependencies as arguments (store, agent, limits, clock) so
 * the decisions are testable without a database or an agent server, and so no route can
 * accidentally reach the agent without going through the budget and audit steps.
 *
 * Invariants:
 * - only sanitized briefs are sent to the agent, never raw ticket text;
 * - the support_requests row is never written here; findings live on the investigation,
 *   and the only ticket write is the reviewed internal findings note, which a human asks
 *   for explicitly and which never changes status, priority or a student-visible message;
 * - a failure always leaves the run in a terminal state, so the single active slot frees;
 * - nothing returned to a caller contains the agent URL, the agent key or the model key;
 * - an investigation gets its own container and volume, addressed at run time, and that
 *   workspace is destroyed on every exit — success, cancellation, failure, budget stop and
 *   gateway restart — so no run's files or processes outlive it.
 */

import {
  isTerminalStatus,
  runStatusForFailure,
  type AgentActivityEvent,
  type ConversationSnapshot,
  type CreateConversationInput,
} from "@/lib/labops/agent-protocol";
import { AgentServerError, workspaceDirForRun } from "@/lib/labops/agent";
import {
  isContextStale,
  type ContextFreshness,
} from "@/lib/labops/conversation";
import { buildFindingsNote } from "@/lib/labops/findings-note";
import {
  canStartRun,
  evaluateRunBudget,
  statusForStopReason,
  type LabOpsLimits,
  type UsageSnapshot,
} from "@/lib/labops/budgets";
import {
  buildInvestigationBrief,
  evaluateEligibility,
  type SupportRequestRow,
} from "@/lib/labops/intake";
import type { LabOpsIdentity } from "@/lib/labops/policy";
import type { WorkspaceHandle, WorkspaceRuntime } from "@/lib/labops/workspace";
import {
  isActiveStatus,
  summarizeRun,
  type LabOpsStore,
  type RunRow,
  type RunStatus,
  type RunSummary,
} from "@/lib/labops/store";

/** The only agent-server surface the orchestration is allowed to use. */
export type AgentPort = {
  createConversation(
    input: Omit<CreateConversationInput, "llm"> & {
      llm?: CreateConversationInput["llm"];
    },
  ): Promise<ConversationSnapshot>;
  run(conversationId: string): Promise<void>;
  cancel(conversationId: string): Promise<{ stopped: boolean }>;
  getConversation(
    conversationId: string,
    context?: { started?: boolean },
  ): Promise<ConversationSnapshot>;
  streamActivity(
    conversationId: string,
    options?: {
      pageId?: string;
      pollIntervalMs?: number;
      deadlineMs?: number;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<
    | { type: "event"; event: AgentActivityEvent }
    | { type: "status"; snapshot: ConversationSnapshot }
    | { type: "deadline"; snapshot: ConversationSnapshot }
  >;
  health(): Promise<{ ok: boolean }>;
  /** Present on real clients: waits for a just-launched container to accept calls. */
  waitUntilReady?(options: { timeoutMs: number }): Promise<void>;
};

export type RunDeps = {
  store: LabOpsStore;
  /**
   * Fallback agent. Under per-run isolation it is only used for the health probe, since
   * every investigation has its own container; under LABOPS_RUNTIME_MODE=shared it is the
   * agent for every run.
   */
  agent: AgentPort;
  limits: LabOpsLimits;
  provider: string;
  model: string;
  now?: () => number;
  /** Per-investigation container runtime. Absent means the shared Phase 1 topology. */
  runtime?: WorkspaceRuntime;
  /** Builds a client for one investigation's container address. */
  agentFor?: (handle: WorkspaceHandle) => AgentPort;
  /** Model settings for a run: the proxy address and its per-run path, never a provider key. */
  llmFor?: (runId: string) => CreateConversationInput["llm"];
  readyTimeoutMs?: number;
};

/**
 * The agent for a run. Resolved on every call rather than configured, because a run's
 * container is created when it starts and destroyed when it ends: a stale address would
 * otherwise let one investigation's traffic reach another's container.
 */
async function agentForRun(deps: RunDeps, run: Pick<RunRow, "id">): Promise<AgentPort> {
  if (!deps.runtime || !deps.agentFor) {
    return deps.agent;
  }

  const handle = await deps.runtime.inspect(run.id);

  if (!handle || !handle.running) {
    throw new AgentServerError(
      "unavailable",
      "This investigation's workspace is no longer running, so it cannot be reached.",
    );
  }

  return deps.agentFor(handle);
}

/**
 * Destroys a run's container and volume and records the disposition. Never throws: a
 * workspace that resists cleanup must not stop the run reaching a terminal state, so the
 * failure is audited and the periodic sweep retries it.
 */
async function destroyWorkspace(deps: RunDeps, runId: string) {
  if (!deps.runtime) {
    return;
  }

  try {
    await deps.runtime.destroy(runId);
    await deps.store.markWorkspaceDestroyed(runId);
    await deps.store.recordToolAction({
      runId,
      tool: "runtime.workspace.destroy",
      outcome: "succeeded",
      responseSummary: "Investigation container and volume removed.",
    });
  } catch (error) {
    await deps.store.recordToolAction({
      runId,
      tool: "runtime.workspace.destroy",
      outcome: "failed",
      responseSummary:
        error instanceof Error ? error.message : "Workspace cleanup failed.",
    });
  }
}

export type StartFailureCode =
  | "request_not_found"
  | "request_ineligible"
  | "limit_reached"
  | "agent_unavailable";

export type StartResult =
  | { ok: true; run: RunSummary }
  | { ok: false; code: StartFailureCode; reason: string };

export type CancelFailureCode = "run_not_found" | "already_terminal";

export type CancelResult =
  | { ok: true; run: RunSummary }
  | { ok: false; code: CancelFailureCode; reason: string };

function titleFor(request: SupportRequestRow, subject: string) {
  const trimmed = subject.trim() || "Support request";

  return trimmed.length > 120
    ? `${trimmed.slice(0, 117)}...`
    : `${trimmed} (${request.category})`;
}

export async function startInvestigation(
  deps: RunDeps,
  input: { identity: LabOpsIdentity; supportRequestId: string },
): Promise<StartResult> {
  const request = await deps.store.getSupportRequest(input.supportRequestId);

  if (!request) {
    return {
      ok: false,
      code: "request_not_found",
      reason: "That support request does not exist.",
    };
  }

  const eligibility = evaluateEligibility(request);

  if (!eligibility.eligible) {
    return { ok: false, code: "request_ineligible", reason: eligibility.reason };
  }

  const [activeRuns, monthToDateCostUsd] = await Promise.all([
    deps.store.countActiveRuns(),
    deps.store.monthToDateCostUsd(),
  ]);
  const startDecision = canStartRun(deps.limits, { activeRuns, monthToDateCostUsd });

  if (!startDecision.allowed) {
    return { ok: false, code: "limit_reached", reason: startDecision.reason };
  }

  const [podLabel, conversation] = await Promise.all([
    deps.store.getPodLabel(request.lab_assignment_id),
    deps.store.getSupportConversation(request.id),
  ]);
  const brief = buildInvestigationBrief(request, {
    podLabel,
    messages: conversation.messages,
    messageAttachments: conversation.attachments,
  });
  const run = await deps.store.createRun({
    supportRequestId: request.id,
    requestedBy: input.identity.userId,
    title: titleFor(request, brief.subject),
    brief,
    model: deps.model,
    provider: deps.provider,
    tokenBudget: deps.limits.runTokenBudget,
    wallclockLimitSeconds: deps.limits.runWallclockMinutes * 60,
  });

  try {
    const agent = await launchWorkspace(deps, run);
    const conversation = await agent.createConversation({
      workingDir: workspaceDirForRun(run.id),
      initialMessage: brief.prompt,
      title: run.title,
      tags: { runid: run.id, supportrequestid: request.id },
      llm: deps.llmFor?.(run.id),
    });

    await deps.store.attachConversation(run.id, conversation.id);
    await deps.store.appendMessage(run.id, "user", brief.prompt);
    await agent.run(conversation.id);
    await deps.store.markRunStarted(run.id);
    await deps.store.recordToolAction({
      runId: run.id,
      tool: "agent.conversation.start",
      target: `support_request:${request.id}`,
      outcome: "succeeded",
      responseSummary: `Investigation started with ${deps.model}.`,
    });

    const started = await deps.store.getRun(run.id);

    return { ok: true, run: summarizeRun(started ?? run) };
  } catch (error) {
    const failure = await failRun(deps, run, error);

    return { ok: false, code: "agent_unavailable", reason: failure.reason };
  }
}

/**
 * Gives the run its own container, records it, and waits for the agent inside to answer.
 * Under the shared topology there is nothing to launch.
 */
async function launchWorkspace(deps: RunDeps, run: RunRow): Promise<AgentPort> {
  if (!deps.runtime || !deps.agentFor) {
    return deps.agent;
  }

  const handle = await deps.runtime.start(run.id);

  await deps.store.recordWorkspace({
    runId: run.id,
    containerName: handle.containerName,
    imageDigest: handle.imageDigest,
    volumeName: handle.volumeName,
  });
  await deps.store.recordToolAction({
    runId: run.id,
    tool: "runtime.workspace.create",
    target: handle.containerName,
    outcome: "succeeded",
    responseSummary: `Isolated workspace created on ${handle.imageDigest || "the pinned agent image"}.`,
  });

  const agent = deps.agentFor(handle);

  await agent.waitUntilReady?.({ timeoutMs: deps.readyTimeoutMs ?? 120_000 });

  return agent;
}

/**
 * Any agent or transport failure ends the investigation, so a crashed start cannot hold
 * the single active slot for the pilot.
 */
async function failRun(deps: RunDeps, run: RunRow, error: unknown) {
  const agentError = error instanceof AgentServerError ? error : null;
  const status: RunStatus = agentError
    ? (runStatusForFailure(agentError.code) as RunStatus)
    : "failed";
  const reason = agentError
    ? agentError.message
    : error instanceof Error
      ? error.message
      : "The investigation could not be started.";

  await deps.store.updateRunStatus(run.id, status === "running" ? "failed" : status, {
    failureReason: reason,
  });
  await deps.store.recordToolAction({
    runId: run.id,
    tool: "agent.conversation.start",
    outcome: "failed",
    responseSummary: reason,
  });
  await destroyWorkspace(deps, run.id);

  return { status, reason };
}

export async function cancelInvestigation(
  deps: RunDeps,
  input: { identity: LabOpsIdentity; runId: string },
): Promise<CancelResult> {
  const run = await deps.store.getRun(input.runId);

  if (!run) {
    return {
      ok: false,
      code: "run_not_found",
      reason: "That investigation does not exist.",
    };
  }

  if (!isActiveStatus(run.status)) {
    return {
      ok: false,
      code: "already_terminal",
      reason: `The investigation is already ${run.status.replace(/_/g, " ")}.`,
    };
  }

  let stopped = true;

  if (run.agent_conversation_id) {
    try {
      ({ stopped } = await (await agentForRun(deps, run)).cancel(run.agent_conversation_id));
    } catch (error) {
      // The run is still marked cancelled: the operator's intent wins over a failed
      // stop call, and the agent server is paused or unreachable either way.
      stopped = false;
      await deps.store.recordToolAction({
        runId: run.id,
        tool: "agent.conversation.cancel",
        outcome: "failed",
        responseSummary: error instanceof Error ? error.message : "Cancellation failed.",
      });
    }
  }

  await deps.store.updateRunStatus(run.id, "cancelled", {
    failureReason: `Cancelled by ${input.identity.email ?? input.identity.userId}.`,
  });
  await deps.store.recordToolAction({
    runId: run.id,
    tool: "agent.conversation.cancel",
    outcome: stopped ? "succeeded" : "allowed",
    responseSummary: stopped
      ? "Agent goal stopped."
      : "Agent stop did not confirm; investigation marked cancelled.",
  });
  // The container goes whether or not the stop call confirmed: removing it is what
  // actually guarantees the run stopped working and spending.
  await destroyWorkspace(deps, run.id);

  const cancelled = await deps.store.getRun(run.id);

  return { ok: true, run: summarizeRun(cancelled ?? run) };
}

function isErrorEvent(event: AgentActivityEvent) {
  return /error/i.test(event.kind);
}

/**
 * A failed conversation with nothing to say about why is worse than useless to the
 * operator, so a failure always carries text: the agent's own (already redacted) error
 * when there is one, and otherwise a statement of what is known.
 */
export function failureReasonFor(status: RunStatus, errorSummary: string | null) {
  if (status !== "failed" && status !== "provider_error" && status !== "timed_out") {
    return undefined;
  }

  return (
    errorSummary ??
    "The agent stopped without completing the investigation and reported no error. Check the provider configuration on the LabOps host."
  );
}

export type RelayFrame =
  | { type: "event"; event: AgentActivityEvent }
  | { type: "status"; status: RunStatus; usage: UsageSnapshot }
  | { type: "budget"; status: RunStatus; reason: string }
  | { type: "error"; reason: string; retryable: boolean }
  | { type: "end"; status: RunStatus };

/**
 * Relays agent activity for the SSE route while persisting it: events land in
 * ai_run_events, spend in ai_model_usage, and the run status follows the conversation.
 * The browser only ever sees what this yields, which is already normalised and redacted.
 */
export async function* relayInvestigation(
  deps: RunDeps,
  input: { runId: string; signal?: AbortSignal },
): AsyncGenerator<RelayFrame> {
  const now = deps.now ?? Date.now;
  const run = await deps.store.getRun(input.runId);

  if (!run) {
    yield { type: "error", reason: "That investigation does not exist.", retryable: false };
    return;
  }

  if (!run.agent_conversation_id) {
    yield { type: "status", status: run.status, usage: await deps.store.runUsage(run.id) };
    yield { type: "end", status: run.status };
    return;
  }

  let agent: AgentPort;

  try {
    agent = await agentForRun(deps, run);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "The investigation workspace is unreachable.";

    if (isActiveStatus(run.status)) {
      await deps.store.updateRunStatus(run.id, "failed", { failureReason: reason });
      await destroyWorkspace(deps, run.id);
    }

    yield { type: "error", reason, retryable: false };
    yield { type: "end", status: "failed" };
    return;
  }

  const startedAt = run.started_at ? Date.parse(run.started_at) : now();
  const deadlineMs = run.wallclock_limit_seconds * 1_000;
  let seq = await deps.store.nextEventSeq(run.id);
  let lastUsage: UsageSnapshot | null = null;
  let finalStatus: RunStatus = run.status;
  /**
   * A provider rejection (bad key, rate limit, model error) reaches us only as an agent
   * error event; the conversation itself just turns `failed`. Without keeping it, the
   * operator sees a bare failed run with no reason at all.
   */
  let lastErrorSummary: string | null = null;

  try {
    for await (const frame of agent.streamActivity(run.agent_conversation_id, {
      signal: input.signal,
      deadlineMs,
    })) {
      if (frame.type === "event") {
        if (isErrorEvent(frame.event) && frame.event.summary) {
          lastErrorSummary = frame.event.summary.slice(0, 500);
        }

        await deps.store.appendEvents(run.id, [frame.event], seq);
        seq += 1;
        yield { type: "event", event: frame.event };
        continue;
      }

      const snapshot = frame.snapshot;
      const status = snapshot.status as RunStatus;

      finalStatus = status;
      lastUsage = snapshot.usage;

      const budget = evaluateRunBudget(deps.limits, {
        usage: snapshot.usage,
        startedAt,
        now: now(),
        monthToDateCostUsd: await deps.store.monthToDateCostUsd(),
      });

      if (frame.type === "deadline" || !budget.shouldContinue) {
        const stopStatus = budget.shouldContinue
          ? "timed_out"
          : (statusForStopReason(budget.stopReason) as RunStatus);
        const reason = budget.shouldContinue
          ? `The ${deps.limits.runWallclockMinutes}-minute time limit for an investigation elapsed.`
          : budget.reason;

        await agent.cancel(run.agent_conversation_id);
        await persistUsage(deps, run, snapshot.usage);
        await deps.store.updateRunStatus(run.id, stopStatus, { failureReason: reason });
        await destroyWorkspace(deps, run.id);
        yield { type: "budget", status: stopStatus, reason };
        yield { type: "end", status: stopStatus };
        return;
      }

      if (status !== run.status) {
        await deps.store.updateRunStatus(run.id, status, {
          failureReason: failureReasonFor(status, lastErrorSummary),
        });
      }

      yield { type: "status", status, usage: snapshot.usage };

      if (isTerminalStatus(snapshot.status)) {
        await persistUsage(deps, run, snapshot.usage);
        await destroyWorkspace(deps, run.id);
        yield { type: "end", status };
        return;
      }
    }
  } catch (error) {
    const agentError = error instanceof AgentServerError ? error : null;
    const reason = agentError
      ? agentError.message
      : error instanceof Error
        ? error.message
        : "Agent activity relay failed.";

    // A dropped or timed-out relay can be resumed by reconnecting, so the run keeps its
    // status. A rate limit or a hard failure ends it instead of holding the active slot.
    if (agentError === null || !agentError.retryable || agentError.code === "rate_limited") {
      finalStatus = agentError ? (runStatusForFailure(agentError.code) as RunStatus) : "failed";
      await deps.store.updateRunStatus(run.id, finalStatus, { failureReason: reason });
      await destroyWorkspace(deps, run.id);
    }

    yield { type: "error", reason, retryable: agentError?.retryable ?? false };
    yield { type: "end", status: finalStatus };
    return;
  }

  if (lastUsage) {
    await persistUsage(deps, run, lastUsage);
  }

  if (!isActiveStatus(finalStatus)) {
    await destroyWorkspace(deps, run.id);
  }

  yield { type: "end", status: finalStatus };
}

export type ReconcileOutcome = {
  /** Runs the database thought were live and that this pass ended. */
  endedRuns: string[];
  /** Containers with no live run behind them that were removed. */
  reapedWorkspaces: string[];
};

/**
 * Restart recovery. A gateway restart severs the relay, so an investigation left running
 * inside its container would keep working and spending with nothing supervising it, no
 * events reaching the database and no wall-clock enforcement. Recovery is therefore
 * deliberate rather than optimistic: every run the database still believes is live is
 * ended and its workspace destroyed, and any investigation container without a live run
 * behind it is reaped.
 */
export async function reconcileInvestigations(deps: RunDeps): Promise<ReconcileOutcome> {
  const active = await deps.store.listActiveRuns();
  const endedRuns: string[] = [];

  for (const run of active) {
    await deps.store.updateRunStatus(run.id, "failed", {
      failureReason:
        "The LabOps gateway restarted while this investigation was running, so it was ended and its workspace destroyed. Start a new investigation.",
    });
    await destroyWorkspace(deps, run.id);
    endedRuns.push(run.id);
  }

  return {
    endedRuns,
    reapedWorkspaces: await reapOrphanWorkspaces(deps, new Set(endedRuns)),
  };
}

/**
 * Periodic sweep. Enforces the wall-clock limit on runs whose relay nobody is watching —
 * the limit is measured from the run's own start time, so it survives a restart — and
 * removes containers whose run is already terminal.
 */
export async function enforceRunDeadlines(deps: RunDeps): Promise<ReconcileOutcome> {
  const now = deps.now ?? Date.now;
  const active = await deps.store.listActiveRuns();
  const endedRuns: string[] = [];

  for (const run of active) {
    const startedAt = Date.parse(run.started_at ?? run.created_at);
    const elapsedSeconds = (now() - startedAt) / 1_000;

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < run.wallclock_limit_seconds) {
      continue;
    }

    if (run.agent_conversation_id) {
      try {
        await (await agentForRun(deps, run)).cancel(run.agent_conversation_id);
      } catch {
        // The container is about to be removed, which stops the run regardless.
      }
    }

    await deps.store.updateRunStatus(run.id, "timed_out", {
      failureReason: `The ${Math.round(
        run.wallclock_limit_seconds / 60,
      )}-minute time limit for an investigation elapsed.`,
    });
    await destroyWorkspace(deps, run.id);
    endedRuns.push(run.id);
  }

  return {
    endedRuns,
    reapedWorkspaces: await reapOrphanWorkspaces(deps, new Set(endedRuns)),
  };
}

/** Destroys every investigation container that no longer has a live run behind it. */
async function reapOrphanWorkspaces(deps: RunDeps, alreadyEnded: Set<string>) {
  if (!deps.runtime) {
    return [];
  }

  const [present, active] = await Promise.all([
    deps.runtime.list(),
    deps.store.listActiveRuns(),
  ]);
  const live = new Set(active.map((run) => run.id));
  const reaped: string[] = [];

  for (const runId of present) {
    if (live.has(runId) && !alreadyEnded.has(runId)) {
      continue;
    }

    await destroyWorkspace(deps, runId);
    reaped.push(runId);
  }

  return reaped;
}

/**
 * The agent reports cumulative spend; ai_model_usage is append-only, so only the
 * difference from what is already recorded is inserted.
 */
async function persistUsage(deps: RunDeps, run: RunRow, cumulative: UsageSnapshot) {
  const recorded = await deps.store.runUsage(run.id);
  const delta: UsageSnapshot = {
    promptTokens: Math.max(0, cumulative.promptTokens - recorded.promptTokens),
    completionTokens: Math.max(0, cumulative.completionTokens - recorded.completionTokens),
    costUsd: Number(Math.max(0, cumulative.costUsd - recorded.costUsd).toFixed(6)),
  };

  await deps.store.recordUsage(run.id, run.provider, run.model, delta);
}

/**
 * Records the operator's conclusion on the investigation. The support request itself is
 * left untouched — staff close it in the portal — so the two records cannot disagree
 * about who resolved the ticket.
 */
export async function recordResolution(
  deps: RunDeps,
  input: {
    runId: string;
    findings?: string | null;
    resolution?: string | null;
    /** Set once the operator has read the newer replies and still wants to conclude. */
    acknowledgeStaleContext?: boolean;
  },
): Promise<
  | { ok: true; run: RunSummary; stale: boolean }
  | { ok: false; code: "run_not_found" | "stale_context"; reason: string }
> {
  const run = await deps.store.getRun(input.runId);

  if (!run) {
    return {
      ok: false,
      code: "run_not_found",
      reason: "That investigation does not exist.",
    };
  }

  const stale = await isRunContextStale(deps, run);

  if (stale && !input.acknowledgeStaleContext) {
    return {
      ok: false,
      code: "stale_context",
      reason:
        "The ticket has new replies the investigation never read. Review them, then either" +
        " confirm this conclusion or start a new investigation.",
    };
  }

  const status: RunStatus = isActiveStatus(run.status) ? "succeeded" : run.status;

  await deps.store.updateRunStatus(run.id, status, {
    findings: input.findings ?? run.findings,
    resolution: input.resolution ?? run.resolution,
  });

  const updated = await deps.store.getRun(run.id);

  return {
    ok: true,
    run: summarizeRun(updated ?? run, await deps.store.runUsage(run.id)),
    stale,
  };
}

/**
 * Adds the reviewed findings to the ticket as an internal system note.
 *
 * Only reachable when a human asks for it: nothing in the agent path calls this. The
 * `support_notes` write switch (disabled by default, and treated as disabled while the
 * Phase 2 migration is unapplied) is the second gate, and the run id marker makes the
 * write idempotent.
 */
export async function publishReviewedFindings(
  deps: RunDeps,
  input: { runId: string; actorUserId: string },
): Promise<
  | { ok: true; created: boolean }
  | {
      ok: false;
      code: "run_not_found" | "no_findings" | "writes_disabled";
      reason: string;
    }
> {
  const run = await deps.store.getRun(input.runId);

  if (!run) {
    return { ok: false, code: "run_not_found", reason: "That investigation does not exist." };
  }

  if (!run.findings?.trim()) {
    return {
      ok: false,
      code: "no_findings",
      reason: "This investigation has no findings to file yet.",
    };
  }

  if (!(await deps.store.isWriteEnabled("support_notes"))) {
    return {
      ok: false,
      code: "writes_disabled",
      reason: "Writing notes back to tickets is disabled. Enable the support_notes switch first.",
    };
  }

  const note = buildFindingsNote({
    runId: run.id,
    findings: run.findings,
    resolution: run.resolution,
    model: run.model,
  });

  const { created } = await deps.store.publishFindingsNote({
    runId: run.id,
    supportRequestId: run.support_request_id,
    body: note.body,
  });

  await deps.store.recordToolAction({
    runId: run.id,
    tool: "support.internal_note",
    target: run.support_request_id,
    isWrite: true,
    outcome: created ? "succeeded" : "denied",
    request: { actorUserId: input.actorUserId, reviewed: true },
    responseSummary: created
      ? "Internal findings note added to the ticket."
      : "A findings note for this investigation already exists.",
  });

  return { ok: true, created };
}

/**
 * True when the ticket moved on after the run captured its context: a new student reply, or
 * a message inside the captured window the run never read. Runs started before freshness
 * was recorded have no captured state and are treated as current.
 */
export async function isRunContextStale(deps: RunDeps, run: RunRow) {
  const captured = (run.sanitized_context as { freshness?: ContextFreshness } | null)
    ?.freshness;

  if (!captured?.lastMessageAt) {
    return false;
  }

  const request = await deps.store.getSupportRequest(run.support_request_id);

  if (!request) {
    return false;
  }

  const { messages } = await deps.store.getSupportConversation(run.support_request_id);
  // Compare the newest slice of the same size the run read, so messages it deliberately
  // dropped for its size bound are not mistaken for new activity.
  const recentMessageIds = messages
    .slice(-Math.max(1, captured.includedMessageIds.length))
    .map((message) => message.id);

  return isContextStale(captured, {
    lastMessageAt: request.last_message_at,
    recentMessageIds,
  });
}
