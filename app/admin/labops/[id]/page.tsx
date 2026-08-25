import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import {
  ActivityStream,
  ApprovalDecision,
  CancelInvestigationButton,
  ResolutionForm,
} from "@/components/labops/actions";
import { requireManager } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { authorizeLabOpsRequest } from "@/lib/labops/authz";
import { isUuid } from "@/lib/labops/http";
import { isActiveStatus, labopsStore } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

type SanitizedContext = {
  podLabel?: string | null;
  subject?: string;
  description?: string;
  attachments?: string[];
  provenance?: { pii?: string[]; neutralized?: string[]; truncated?: boolean };
};

/** Investigation workspace: what was sent, what the agent did, and what it cost. */
export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { roles } = await requireManager();
  const read = await authorizeLabOpsRequest("read_investigations");

  if (!read.ok) {
    notFound();
  }

  const { id } = await params;

  if (!isUuid(id)) {
    notFound();
  }

  const store = labopsStore();
  const run = await store.getRun(id);

  if (!run) {
    notFound();
  }

  const [operator, approver, usage, events, messages, toolActions, approvals] = await Promise.all([
    authorizeLabOpsRequest("cancel_investigation"),
    authorizeLabOpsRequest("decide_approval"),
    store.runUsage(run.id),
    store.listEvents(run.id),
    store.listMessages(run.id),
    store.listToolActions(run.id),
    store.listApprovals(run.id),
  ]);
  const context = (run.sanitized_context ?? {}) as SanitizedContext;
  const active = isActiveStatus(run.status);

  return (
    <AppShell roles={roles} title={run.title}>
      <Card eyebrow="Investigation" title={run.status.replaceAll("_", " ")}>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="eyebrow">Model</dt>
            <dd className="mt-1 font-bold">{run.model}</dd>
          </div>
          <div>
            <dt className="eyebrow">Tokens</dt>
            <dd className="mt-1 font-bold">
              {(usage.promptTokens + usage.completionTokens).toLocaleString()} of{" "}
              {run.token_budget.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Cost</dt>
            <dd className="mt-1 font-bold">${usage.costUsd.toFixed(4)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Started</dt>
            <dd className="mt-1 font-bold">
              {run.started_at ? formatDateTime(run.started_at) : "—"}
            </dd>
          </div>
        </dl>
        {run.failure_reason ? (
          <p className="mt-4 text-sm font-semibold text-amber-200">{run.failure_reason}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link className="button secondary" href="/admin/labops">
            Back to console
          </Link>
          <Link className="button secondary" href="/admin/queue">
            Source ticket: {run.support_request_id.slice(0, 8)}
          </Link>
          {active && operator.ok ? <CancelInvestigationButton runId={run.id} /> : null}
        </div>
      </Card>

      {active ? (
        <Card eyebrow="Live" title="Agent activity">
          <ActivityStream initialStatus={run.status} runId={run.id} />
        </Card>
      ) : null}

      <Card eyebrow="Sent to the model" title="Sanitized ticket context">
        <p className="text-sm text-slate-400">
          Pod {context.podLabel ?? "unknown"} — no student name or email leaves the portal, and
          attachment contents are never forwarded.
        </p>
        <p className="mt-3 font-bold">{context.subject}</p>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{context.description}</pre>
        {context.attachments && context.attachments.length > 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            Attachments listed: {context.attachments.join(", ")}
          </p>
        ) : null}
        {context.provenance?.pii?.length || context.provenance?.neutralized?.length ? (
          <p className="mt-3 text-sm text-amber-200">
            Removed before sending: {[...(context.provenance.pii ?? []), ...(context.provenance.neutralized ?? [])].join(", ")}
          </p>
        ) : null}
      </Card>

      {approvals.length > 0 ? (
        <Card eyebrow="Confirmation gate" title="Approval requests">
          <div className="grid gap-4">
            {approvals.map((approval) => (
              <div className="rounded-lg border border-cyan-200/10 bg-slate-900/40 p-4" key={approval.id}>
                <p className="font-bold">{approval.action_kind.replaceAll("_", " ")}</p>
                <p className="text-sm text-slate-300">
                  <span className="status-pill">{approval.status}</span>{" "}
                  {approval.decided_at ? `decided ${formatDateTime(approval.decided_at)}` : ""}
                </p>
                {approval.decision_note ? (
                  <p className="mt-2 text-sm text-slate-300">{approval.decision_note}</p>
                ) : null}
                {approval.status === "pending" && approver.ok ? (
                  <div className="mt-3">
                    <ApprovalDecision approvalId={approval.id} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card eyebrow="Audit" title="Recorded timeline">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Kind</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={`${event.run_id}-${event.seq}`}>
                  <td>{event.seq}</td>
                  <td>{event.kind}</td>
                  <td>{formatDateTime(event.created_at)}</td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={3}>No agent events recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Audit" title="Tool actions">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Target</th>
                <th>Write</th>
                <th>Outcome</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {toolActions.map((action) => (
                <tr key={action.id}>
                  <td>{action.tool}</td>
                  <td>{action.target ?? "—"}</td>
                  <td>{action.is_write ? "yes" : "no"}</td>
                  <td>
                    <span className="status-pill">{action.outcome}</span>
                  </td>
                  <td className="max-w-md">{action.response_summary ?? "—"}</td>
                </tr>
              ))}
              {toolActions.length === 0 ? (
                <tr>
                  <td colSpan={5}>No tool actions recorded.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Transcript" title="Messages">
        <div className="grid gap-3">
          {messages.map((message) => (
            <div className="rounded-lg border border-cyan-200/10 bg-slate-900/40 p-3" key={message.id}>
              <p className="eyebrow">{message.role}</p>
              <pre className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{message.content}</pre>
            </div>
          ))}
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">No messages recorded.</p>
          ) : null}
        </div>
      </Card>

      {operator.ok ? (
        <Card eyebrow="Outcome" title="Findings and resolution">
          <ResolutionForm findings={run.findings} resolution={run.resolution} runId={run.id} />
        </Card>
      ) : run.findings || run.resolution ? (
        <Card eyebrow="Outcome" title="Findings and resolution">
          <pre className="whitespace-pre-wrap text-sm text-slate-300">{run.findings}</pre>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{run.resolution}</pre>
        </Card>
      ) : null}
    </AppShell>
  );
}
