import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireManager } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ApprovalsPage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("pre_registration_interests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <AppShell roles={roles} title="Approvals">
      <Card eyebrow="Request Intake" title="Pre-registration requests">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Organization</th>
                <th>Interest</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((request) => (
                <tr key={request.id}>
                  <td>
                    <p className="font-bold">{request.name}</p>
                    <p className="text-slate-400">{request.email}</p>
                  </td>
                  <td>{request.organization}</td>
                  <td>{request.interest.replaceAll("_", " ")}</td>
                  <td>
                    <span className="status-pill">{request.status}</span>
                  </td>
                  <td>{formatDateTime(request.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
