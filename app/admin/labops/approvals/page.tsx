import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { ApprovalDecision } from "@/components/labops/actions";
import { requireManager } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { authorizeLabOpsRequest } from "@/lib/labops/authz";
import { labopsStore } from "@/lib/labops/store";

export const dynamic = "force-dynamic";

/**
 * LabOps AI approvals. Deliberately separate from /admin/approvals (seat and enrolment
 * decisions) and from /admin/support: an approver sees the sanitized action a run wants to
 * take and nothing else — no ticket queue, no student identity, no raw ticket text.
 */
export default async function LabOpsApprovalsPage() {
  const { roles } = await requireManager();
  const approver = await authorizeLabOpsRequest("decide_approval");

  if (!approver.ok) {
    notFound();
  }

  const approvals = await labopsStore().listPendingApprovals();

  return (
    <AppShell roles={roles} title="LabOps AI approvals">
      <Card
        eyebrow="Confirmation gate"
        title={`${approvals.length} pending ${approvals.length === 1 ? "action" : "actions"}`}
      >
        <p className="text-sm text-slate-300">
          Every external action an investigation proposes waits here. Approving records the
          decision and lets the gateway execute it once; nothing runs from this page itself,
          and an action can never be approved by the account that requested it.
        </p>
        <div className="mt-5 grid gap-4">
          {approvals.map((approval) => {
            const expired = new Date(approval.expires_at).getTime() <= Date.now();
            const selfRequested = approval.requested_by === approver.identity.userId;

            return (
              <div
                className="rounded-lg border border-cyan-200/10 bg-slate-900/40 p-4"
                key={approval.id}
              >
                <p className="font-bold">{approval.action_kind.replaceAll("_", " ")}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {approval.runTitle} · requested {formatDateTime(approval.created_at)} ·
                  expires {formatDateTime(approval.expires_at)}
                </p>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-slate-950/60 p-3 text-xs text-slate-300">
                  {JSON.stringify(approval.action_payload, null, 2)}
                </pre>
                <Link
                  className="mt-3 inline-flex text-sm font-bold text-cyan-100 hover:text-white"
                  href={`/admin/labops/${approval.run_id}`}
                >
                  Open the investigation
                </Link>
                {expired ? (
                  <p className="mt-3 text-sm font-semibold text-amber-200">
                    This request has expired and can no longer be approved. The run must
                    propose it again.
                  </p>
                ) : selfRequested ? (
                  <p className="mt-3 text-sm font-semibold text-amber-200">
                    You started this investigation, so someone else has to decide this action.
                  </p>
                ) : (
                  <div className="mt-3">
                    <ApprovalDecision approvalId={approval.id} />
                  </div>
                )}
              </div>
            );
          })}
          {approvals.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nothing is waiting for a decision.
            </p>
          ) : null}
        </div>
      </Card>
    </AppShell>
  );
}
