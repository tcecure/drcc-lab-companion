"use client";

/**
 * The interactive LabOps controls. Everything here talks to /api/labops only — the
 * private agent server is never addressable from a browser — and the gateway re-checks
 * authorization on every call, so a hidden button is a convenience, not a control.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "The gateway rejected the request.");
  }

  return payload;
}

function Problem({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm font-semibold text-rose-200">{children}</p>;
}

export function StartInvestigationButton({
  disabled,
  disabledReason,
  supportRequestId,
}: {
  disabled?: boolean;
  disabledReason?: string | null;
  supportRequestId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (disabled) {
    return <span className="text-sm text-slate-400">{disabledReason ?? "Not available"}</span>;
  }

  return (
    <div>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);

          try {
            const payload = (await post("/api/labops/investigations", {
              supportRequestId,
            })) as { investigation?: { id: string } } | null;

            if (payload?.investigation?.id) {
              router.push(`/admin/labops/${payload.investigation.id}`);
              return;
            }

            router.refresh();
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : "Could not start.");
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        {busy ? "Starting…" : "Investigate"}
      </button>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

export function CancelInvestigationButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);

          try {
            await post(`/api/labops/investigations/${runId}/cancel`);
            router.refresh();
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : "Could not cancel.");
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        {busy ? "Stopping…" : "Stop investigation"}
      </button>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

/**
 * Files the reviewed findings on the source ticket as an internal note. Deliberately a
 * separate, explicit click: the note is the only ticket write the console makes, and the
 * gateway still refuses unless the support_notes write switch is on.
 */
export function FileFindingsNoteButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  return (
    <div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setOutcome(null);

          try {
            const payload = (await post(
              `/api/labops/investigations/${runId}/findings-note`,
            )) as { created?: boolean } | null;

            setOutcome(
              payload?.created
                ? "Internal note added to the ticket."
                : "This investigation was already filed on the ticket.",
            );
            router.refresh();
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : "Could not file the note.");
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        {busy ? "Filing…" : "File findings as internal note"}
      </button>
      {outcome ? <p className="mt-2 text-sm text-cyan-200">{outcome}</p> : null}
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

export function ApprovalDecision({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);

    try {
      await post(`/api/labops/approvals/${approvalId}`, { decision, note: note || undefined });
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Decision note
        <input
          className="input mt-1"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this action is or is not allowed"
          value={note}
        />
      </label>
      <div className="flex gap-2">
        <button className="button" disabled={busy} onClick={() => decide("approved")} type="button">
          Approve
        </button>
        <button className="button secondary" disabled={busy} onClick={() => decide("rejected")} type="button">
          Reject
        </button>
      </div>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

export function ResolutionForm({
  findings,
  resolution,
  runId,
}: {
  findings: string | null;
  resolution: string | null;
  runId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ findings: findings ?? "", resolution: resolution ?? "" });

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);

        try {
          const response = await fetch(`/api/labops/investigations/${runId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(payload?.error ?? "The gateway rejected the request.");
          }

          setSaved(true);
          router.refresh();
        } catch (problem) {
          setError(problem instanceof Error ? problem.message : "Could not save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Findings
        <textarea
          className="input mt-1 min-h-24"
          onChange={(event) => setForm({ ...form, findings: event.target.value })}
          value={form.findings}
        />
      </label>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Resolution
        <textarea
          className="input mt-1 min-h-24"
          onChange={(event) => setForm({ ...form, resolution: event.target.value })}
          value={form.resolution}
        />
      </label>
      <div className="flex items-center gap-3">
        <button className="button" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save to investigation"}
        </button>
        {saved ? <span className="text-sm text-cyan-200">Saved.</span> : null}
      </div>
      <p className="text-xs text-slate-400">
        Saved on the investigation only. The support request stays the authoritative ticket and is
        closed in the portal as usual.
      </p>
      {error ? <Problem>{error}</Problem> : null}
    </form>
  );
}

type Frame =
  | { type: "event"; event: { id: string; kind: string; summary: string | null; toolName: string | null; timestamp: string | null; redacted: boolean } }
  | { type: "status"; status: string; usage: { promptTokens: number; completionTokens: number; costUsd: number } }
  | { type: "budget"; status: string; reason: string }
  | { type: "error"; reason: string; retryable: boolean }
  | { type: "end"; status: string };

/**
 * The gate on every agent action. The agent server holds each proposed step until it is
 * answered, so an investigation makes no progress without a decision here; refusing sends
 * the reason back and lets the agent try something else instead of ending the run.
 */
function StepDecision({
  runId,
  proposed,
  onDecided,
}: {
  runId: string;
  proposed: string | null;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = async (accept: boolean) => {
    setBusy(true);
    setError(null);

    try {
      await post(`/api/labops/investigations/${runId}/step`, {
        accept,
        ...(accept || !reason.trim() ? {} : { reason: reason.trim() }),
      });
      setReason("");
      onDecided();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not send that decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200/30 bg-amber-500/5 p-3">
      <p className="text-sm font-semibold text-amber-100">
        The agent is waiting for your decision on its next step.
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
        {proposed ?? "The proposed step has no description."}
      </p>
      <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Reason (sent to the agent when you refuse)
        <input
          className="input mt-1"
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button className="button" disabled={busy} onClick={() => decide(true)} type="button">
          {busy ? "Sending…" : "Allow this step"}
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => decide(false)}
          type="button"
        >
          Refuse
        </button>
      </div>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

/**
 * Live agent activity for an active investigation, over the gateway's SSE relay. The
 * frames are already normalised and redacted server-side; the timeline is also persisted,
 * so closing this page loses nothing.
 */
export function ActivityStream({
  runId,
  initialStatus,
  canDecideSteps = false,
  pendingStep = null,
}: {
  runId: string;
  initialStatus: string;
  /** Only the pilot operator may decide a step; the gateway enforces it regardless. */
  canDecideSteps?: boolean;
  /**
   * The held action as already persisted. The relay does not re-send an event it has
   * stored, so this is what an operator arriving after the fact has to decide on.
   */
  pendingStep?: string | null;
}) {
  const router = useRouter();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [problem, setProblem] = useState<string | null>(null);
  /** Bumped after a step decision, which reconnects the relay to follow the resumed run. */
  const [generation, setGeneration] = useState(0);
  const finished = useRef(false);

  useEffect(() => {
    finished.current = false;
    const source = new EventSource(`/api/labops/investigations/${runId}/activity`);

    const handle = (raw: MessageEvent) => {
      const frame = JSON.parse(raw.data) as Frame;

      if (frame.type === "event") {
        setFrames((current) => [...current.slice(-199), frame]);
        return;
      }

      if (frame.type === "status" || frame.type === "budget" || frame.type === "end") {
        setStatus(frame.status);
      }

      if (frame.type === "budget" || frame.type === "error") {
        setProblem(frame.type === "budget" ? frame.reason : frame.reason);
      }

      if (frame.type === "end") {
        finished.current = true;
        source.close();
        router.refresh();
      }
    };

    for (const type of ["event", "status", "budget", "error", "end"]) {
      source.addEventListener(type, handle as EventListener);
    }

    source.onerror = () => {
      if (!finished.current) {
        setProblem("The activity relay disconnected. Reload to reconnect.");
      }

      source.close();
    };

    return () => source.close();
  }, [generation, router, runId]);

  const liveStep = frames.reduce<Frame | null>(
    (latest, frame) =>
      frame.type === "event" && /action/i.test(frame.event.kind) ? frame : latest,
    null,
  );
  const proposed =
    liveStep?.type === "event"
      ? (liveStep.event.summary ?? liveStep.event.toolName ?? liveStep.event.kind)
      : pendingStep;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-slate-300">
        Live status: <span className="status-pill">{status.replaceAll("_", " ")}</span>
      </p>
      {problem ? <Problem>{problem}</Problem> : null}
      {status === "awaiting_approval" && !canDecideSteps ? (
        <p className="text-sm text-amber-200">
          The agent is waiting for the pilot operator to allow or refuse its next step.
        </p>
      ) : null}
      {status === "awaiting_approval" && canDecideSteps ? (
        <StepDecision
          onDecided={() => {
            setStatus("running");
            setProblem(null);
            setGeneration((current) => current + 1);
          }}
          proposed={proposed}
          runId={runId}
        />
      ) : null}
      <ol className="grid gap-2">
        {frames.map((frame, index) =>
          frame.type === "event" ? (
            <li className="rounded-lg border border-cyan-200/10 bg-slate-900/40 p-3 text-sm" key={`${frame.event.id}-${index}`}>
              <p className="font-semibold">
                {frame.event.toolName ?? frame.event.kind}
                {frame.event.redacted ? (
                  <span className="ml-2 text-xs text-amber-200">redacted</span>
                ) : null}
              </p>
              <p className="text-slate-300">{frame.event.summary ?? "(no summary)"}</p>
            </li>
          ) : null,
        )}
      </ol>
      {frames.length === 0 ? (
        <p className="text-sm text-slate-400">Waiting for the agent to report activity…</p>
      ) : null}
    </div>
  );
}
