"use client";

/**
 * Direct Chat: the operator types a question and talks to the LabOps agent, with no
 * ticket involved. The browser only ever calls /api/labops — the agent server, the model
 * proxy and their credentials are not addressable from here — and every one of those
 * calls is authorized again on the gateway, so the controls below are convenience, not
 * access control.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/components/labops/markdown";
import { StepDecision } from "@/components/labops/actions";

export const promptMaxLength = 12_000;

export type ChatMessage = { role: string; content: string; createdAt: string };

export type ChatActivity = {
  id: string;
  kind: string;
  summary: string | null;
  toolName: string | null;
  redacted: boolean;
};

export type ChatConversation = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  tokenBudget: number;
  messages: ChatMessage[];
  activity: ChatActivity[];
  /** The held step as persisted, so a reload still shows what is being asked. */
  pendingStep: string | null;
};

export type ChatHistoryEntry = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

const activeStatuses = new Set(["queued", "running", "paused", "awaiting_approval"]);

/** Operator-facing wording. `paused` is the agent listening, so it reads as Ready. */
function statusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Starting";
    case "running":
      return "Running";
    case "paused":
      return "Ready";
    case "awaiting_approval":
      return "Awaiting confirmation";
    case "succeeded":
      return "Finished";
    case "cancelled":
      return "Stopped";
    case "timed_out":
      return "Time limit reached";
    case "budget_exhausted":
      return "Budget limit reached";
    default:
      return "Ended with an error";
  }
}

type Frame =
  | { type: "event"; event: ChatActivity & { timestamp: string | null } }
  | {
      type: "status";
      status: string;
      usage: { promptTokens: number; completionTokens: number; costUsd: number };
    }
  | { type: "budget"; status: string; reason: string }
  | { type: "error"; reason: string; retryable: boolean }
  | { type: "end"; status: string };

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; investigation?: { id: string } }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "The gateway rejected the request.");
  }

  return payload;
}

function elapsedLabel(from: string | null, to: number) {
  if (!from) {
    return "—";
  }

  const seconds = Math.max(0, Math.round((to - Date.parse(from)) / 1_000));
  const minutes = Math.floor(seconds / 60);

  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function DirectChat({
  conversation,
  history,
  hasMore,
  page,
  limits,
}: {
  conversation: ChatConversation | null;
  history: ChatHistoryEntry[];
  hasMore: boolean;
  page: number;
  limits: { runWallclockMinutes: number; runCostBudgetUsd: number };
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [status, setStatus] = useState(conversation?.status ?? "idle");
  const [usage, setUsage] = useState(conversation?.usage ?? null);
  const [liveActivity, setLiveActivity] = useState<ChatActivity[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  /** Bumped whenever the run should be followed again: a follow-up, or a decided step. */
  const [generation, setGeneration] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const closedByServer = useRef(false);
  const conversationId = conversation?.id ?? null;

  useEffect(() => {
    setStatus(conversation?.status ?? "idle");
    setUsage(conversation?.usage ?? null);
    setLiveActivity([]);
    setPendingUserMessage(null);
    setError(null);
    setLimitNotice(null);
  }, [conversation?.id, conversation?.status, conversation?.usage]);

  useEffect(() => {
    // Ready means the agent is idle and listening: there is nothing to stream until the
    // operator sends the next message, which reopens this through `generation`.
    if (!conversationId || !activeStatuses.has(status) || status === "paused") {
      return;
    }

    closedByServer.current = false;

    const source = new EventSource(`/api/labops/investigations/${conversationId}/activity`);
    const handle = (raw: MessageEvent) => {
      const frame = JSON.parse(raw.data) as Frame;

      if (frame.type === "event") {
        setLiveActivity((current) => [...current.slice(-199), frame.event]);
        return;
      }

      if (frame.type === "status") {
        setStatus(frame.status);
        setUsage(frame.usage);
        return;
      }

      if (frame.type === "budget") {
        setStatus(frame.status);
        setLimitNotice(frame.reason);
        return;
      }

      if (frame.type === "error") {
        setError(frame.reason);
        return;
      }

      setStatus(frame.status);
      closedByServer.current = true;
      source.close();
      // The assistant's reply is persisted by the relay, so the transcript comes back
      // from the server rather than being reassembled here.
      router.refresh();
    };

    for (const type of ["event", "status", "budget", "error", "end"]) {
      source.addEventListener(type, handle as EventListener);
    }

    source.onerror = () => {
      if (!closedByServer.current) {
        setError("The live connection dropped. Reload the page to reconnect.");
      }

      source.close();
    };

    return () => source.close();
    // `status` is deliberately not a dependency: the stream reports it, and reopening on
    // every reported status would restart the relay mid-answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, generation, router]);

  useEffect(() => {
    if (!activeStatuses.has(status)) {
      return;
    }

    const timer = setInterval(() => setTick(Date.now()), 1_000);

    return () => clearInterval(timer);
  }, [status]);

  const ready = status === "paused";
  const terminal = conversation !== null && !activeStatuses.has(status);
  const canSend = conversation === null || ready;
  const activity = useMemo(
    () => [...(conversation?.activity ?? []), ...liveActivity],
    [conversation?.activity, liveActivity],
  );
  const transcript = useMemo(() => {
    const messages = conversation?.messages ?? [];

    return pendingUserMessage
      ? [
          ...messages,
          { role: "user", content: pendingUserMessage, createdAt: new Date().toISOString() },
        ]
      : messages;
  }, [conversation?.messages, pendingUserMessage]);

  const send = async () => {
    const text = prompt.trim();

    if (!text || busy || !canSend) {
      return;
    }

    setBusy(true);
    setError(null);
    setLimitNotice(null);

    try {
      if (!conversation) {
        const payload = await post("/api/labops/investigations", {
          source: "direct",
          prompt: text,
        });

        setPrompt("");

        if (payload?.investigation?.id) {
          router.push(`/admin/labops/chat?c=${payload.investigation.id}`);
        } else {
          router.refresh();
        }

        return;
      }

      await post(`/api/labops/investigations/${conversation.id}/messages`, { prompt: text });
      setPrompt("");
      setPendingUserMessage(text);
      setStatus("running");
      setGeneration((current) => current + 1);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send that message.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: "cancel" | "finish") => {
    if (!conversation) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await post(`/api/labops/investigations/${conversation.id}/${path}`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not update the conversation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <aside className="card h-fit">
        <p className="eyebrow">Conversations</p>
        <Link className="button mt-3 w-full justify-center" href="/admin/labops/chat">
          New conversation
        </Link>
        <ul className="mt-4 grid gap-2">
          {history.map((entry) => (
            <li key={entry.id}>
              <Link
                className={`block rounded-lg border p-3 text-sm transition ${
                  entry.id === conversation?.id
                    ? "border-cyan-300/50 bg-slate-900/70"
                    : "border-cyan-200/10 bg-slate-900/40 hover:border-cyan-200/30"
                }`}
                href={`/admin/labops/chat?c=${entry.id}`}
              >
                <span className="block font-semibold text-slate-100">{entry.title}</span>
                <span className="mt-1 block text-xs text-slate-400">
                  {statusLabel(entry.status)} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
          {history.length === 0 ? (
            <li className="text-sm text-slate-400">No conversations yet.</li>
          ) : null}
        </ul>
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 0 ? (
            <Link className="text-cyan-200" href={`/admin/labops/chat?page=${page - 1}`}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link className="text-cyan-200" href={`/admin/labops/chat?page=${page + 1}`}>
              Older
            </Link>
          ) : null}
        </div>
      </aside>

      <section className="grid gap-4">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Conversation</p>
              <h2 className="mt-1 text-lg font-semibold">
                {conversation?.title ?? "Ask LabOps AI"}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="status-pill">{conversation ? statusLabel(status) : "Ready"}</span>
              {conversation && !terminal ? (
                <>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => act("cancel")}
                    type="button"
                  >
                    Stop conversation
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => act("finish")}
                    type="button"
                  >
                    Finish conversation
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="eyebrow">Tokens</dt>
              <dd className="mt-1 font-bold">
                {usage
                  ? `${(usage.promptTokens + usage.completionTokens).toLocaleString()} of ${(conversation?.tokenBudget ?? 0).toLocaleString()}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Estimated cost</dt>
              <dd className="mt-1 font-bold">
                {usage
                  ? `$${usage.costUsd.toFixed(4)} of $${limits.runCostBudgetUsd.toFixed(2)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Elapsed</dt>
              <dd className="mt-1 font-bold">
                {conversation
                  ? `${elapsedLabel(
                      conversation.startedAt,
                      terminal && conversation.endedAt ? Date.parse(conversation.endedAt) : tick,
                    )} of ${limits.runWallclockMinutes}m`
                  : "—"}
              </dd>
            </div>
          </dl>
          {conversation?.failureReason ? (
            <p className="mt-4 text-sm font-semibold text-amber-200">
              {conversation.failureReason}
            </p>
          ) : null}
          {limitNotice ? (
            <p className="mt-2 text-sm font-semibold text-amber-200">{limitNotice}</p>
          ) : null}
          {error ? <p className="mt-2 text-sm font-semibold text-rose-200">{error}</p> : null}
        </div>

        <div className="card">
          <div className="grid gap-3">
            {transcript.map((message, index) => (
              <div
                className={`rounded-lg border p-3 ${
                  message.role === "user"
                    ? "border-cyan-200/20 bg-slate-900/70"
                    : "border-cyan-200/10 bg-slate-900/40"
                }`}
                key={`${message.createdAt}-${index}`}
              >
                <p className="eyebrow">{message.role === "user" ? "You" : "LabOps AI"}</p>
                <div className="mt-2">
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                      {message.content}
                    </p>
                  ) : (
                    <Markdown source={message.content} />
                  )}
                </div>
              </div>
            ))}
            {transcript.length === 0 ? (
              <p className="text-sm text-slate-400">
                Ask a question about the CyberLab environment. Nothing is sent to a support
                ticket, and the assistant confirms every action with you before taking it.
              </p>
            ) : null}
            {status === "running" ? (
              <p className="text-sm text-slate-400">LabOps AI is working…</p>
            ) : null}
          </div>

          {conversation && status === "awaiting_approval" ? (
            <div className="mt-4">
              <StepDecision
                onDecided={() => {
                  setStatus("running");
                  setError(null);
                  setGeneration((current) => current + 1);
                }}
                proposed={
                  [...liveActivity]
                    .reverse()
                    .find((entry) => /action/i.test(entry.kind))?.summary ??
                  conversation.pendingStep
                }
                runId={conversation.id}
              />
            </div>
          ) : null}

          {activity.length > 0 ? (
            <details
              className="mt-4 rounded-lg border border-cyan-200/10 bg-slate-900/40 p-3"
              onToggle={(event) => setActivityOpen(event.currentTarget.open)}
              open={activityOpen}
            >
              <summary className="cursor-pointer text-sm font-semibold text-slate-200">
                Agent activity ({activity.length})
              </summary>
              <ol className="mt-3 grid gap-2">
                {activity.map((entry, index) => (
                  <li className="text-sm" key={`${entry.id}-${index}`}>
                    <span className="font-semibold text-slate-100">
                      {entry.toolName ?? entry.kind}
                    </span>
                    {entry.redacted ? (
                      <span className="ml-2 text-xs text-amber-200">redacted</span>
                    ) : null}
                    <span className="block text-slate-300">{entry.summary ?? "(no detail)"}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>

        <div className="card">
          {terminal ? (
            <p className="text-sm text-slate-300">
              This conversation is {statusLabel(status).toLowerCase()} and its workspace has been
              destroyed. Start a new conversation to ask something else.
            </p>
          ) : (
            <div className="grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Your message
                <textarea
                  className="input mt-1 min-h-28"
                  disabled={busy || !canSend}
                  maxLength={promptMaxLength}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask about a lab, a pod, a verification failure…"
                  value={prompt}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button className="button" disabled={busy || !canSend} onClick={send} type="button">
                  {busy ? "Sending…" : "Send"}
                </button>
                <span className="text-xs text-slate-400">
                  {prompt.length.toLocaleString()} / {promptMaxLength.toLocaleString()} characters ·
                  ⌘/Ctrl + Enter sends · text only
                </span>
              </div>
              {!canSend && conversation ? (
                <p className="text-sm text-slate-400">
                  {status === "awaiting_approval"
                    ? "Allow or refuse the step above before sending another message."
                    : "Wait for the current answer to finish."}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
