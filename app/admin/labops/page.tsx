import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { StartInvestigationButton } from "@/components/labops/actions";
import { requireManager } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { authorizeLabOpsRequest } from "@/lib/labops/authz";
import { describeLabOpsConfig, isLabOpsConfigured } from "@/lib/labops/config";
import { evaluateEligibility } from "@/lib/labops/intake";
import { isActiveStatus, labopsStore } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

/**
 * LabOps AI console. Staff see it read-only; only the pilot operator can start or stop an
 * investigation, and students never reach this route at all.
 */
export default async function LabOpsPage() {
  const { roles } = await requireManager();
  const read = await authorizeLabOpsRequest("read_investigations");

  if (!read.ok) {
    notFound();
  }

  if (!isLabOpsConfigured()) {
    return (
      <AppShell roles={roles} title="LabOps AI">
        <Card eyebrow="Not configured" title="LabOps AI is not installed on this host">
          <p className="text-sm text-slate-300">
            The gateway needs its server-side configuration in <code>/etc/labops/labops.env</code>{" "}
            on <code>drcc-labops-01</code> before investigations can run. No key or agent
            address is ever read from the browser.
          </p>
        </Card>
      </AppShell>
    );
  }

  const operator = await authorizeLabOpsRequest("start_investigation");
  const config = describeLabOpsConfig();
  const store = labopsStore();
  const [requests, runs, activeRuns, monthToDateCostUsd] = await Promise.all([
    store.listEligibleSupportRequests(25),
    store.listRuns(25),
    store.countActiveRuns(),
    store.monthToDateCostUsd(),
  ]);
  const investigatedRequestIds = new Set(
    runs.filter((run) => isActiveStatus(run.status)).map((run) => run.support_request_id),
  );
  const atCapacity = activeRuns >= config.limits.maxActiveRuns;

  return (
    <AppShell roles={roles} title="LabOps AI">
      <Card eyebrow="Pilot status" title="Operations">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="eyebrow">Model</dt>
            <dd className="mt-1 font-bold">{config.model}</dd>
          </div>
          <div>
            <dt className="eyebrow">Active investigations</dt>
            <dd className="mt-1 font-bold">
              {activeRuns} of {config.limits.maxActiveRuns}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Spend this month</dt>
            <dd className="mt-1 font-bold">
              ${monthToDateCostUsd.toFixed(2)} of ${config.limits.monthlyCostBudgetUsd.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Run limits</dt>
            <dd className="mt-1 font-bold">
              {config.limits.runTokenBudget.toLocaleString()} tokens ·{" "}
              {config.limits.runWallclockMinutes} min
            </dd>
          </div>
        </dl>
        {operator.ok ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link className="button" href="/admin/labops/chat">
              Ask LabOps AI
            </Link>
            <span className="text-sm text-slate-400">
              Ask a question directly, without opening a support ticket.
            </span>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            Read-only view. Investigations are started and stopped by the pilot operator.
          </p>
        )}
      </Card>

      <Card eyebrow="Intake" title="Support requests eligible for investigation">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const eligibility = evaluateEligibility(request);
                const alreadyRunning = investigatedRequestIds.has(request.id);

                return (
                  <tr key={request.id}>
                    <td className="max-w-sm">
                      <p className="font-bold">{request.subject}</p>
                      <p className="text-slate-400">{request.description.slice(0, 140)}</p>
                    </td>
                    <td>{request.category.replaceAll("_", " ")}</td>
                    <td>{request.priority}</td>
                    <td>
                      <span className="status-pill">{request.status.replaceAll("_", " ")}</span>
                    </td>
                    <td>{formatDateTime(request.created_at)}</td>
                    <td>
                      {operator.ok ? (
                        <StartInvestigationButton
                          disabled={!eligibility.eligible || alreadyRunning || atCapacity}
                          disabledReason={
                            alreadyRunning
                              ? "Investigation in progress"
                              : atCapacity
                                ? "One investigation at a time"
                                : eligibility.eligible
                                  ? null
                                  : eligibility.reason
                          }
                          supportRequestId={request.id}
                        />
                      ) : (
                        <span className="text-sm text-slate-400">Operator only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={6}>No open support requests.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="History" title="Investigations">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Investigation</th>
                <th>Source</th>
                <th>Status</th>
                <th>Started</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link
                      className="font-bold text-cyan-200"
                      href={
                        run.source === "direct"
                          ? `/admin/labops/chat?c=${run.id}`
                          : `/admin/labops/${run.id}`
                      }
                    >
                      {run.title}
                    </Link>
                  </td>
                  <td>{run.source === "direct" ? "Direct chat" : "Support ticket"}</td>
                  <td>
                    <span className="status-pill">{run.status.replaceAll("_", " ")}</span>
                  </td>
                  <td>{run.started_at ? formatDateTime(run.started_at) : "—"}</td>
                  <td>{run.ended_at ? formatDateTime(run.ended_at) : "—"}</td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={5}>No investigations yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
