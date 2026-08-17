import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function StudentLabsPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const supabase = await createClient();
  const { data } = await supabase
    .from("lab_instances")
    .select("*")
    .eq("assigned_user_id", user.id);

  return (
    <AppShell roles={roles} title="Labs">
      <Card eyebrow="Hands-on Environment" title="Assigned lab access">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pod</th>
                <th>Status</th>
                <th>Environment</th>
                <th>Assignment</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.pod_name}</td>
                  <td>
                    <span className="status-pill">{row.status}</span>
                  </td>
                  <td>{row.environment_identifier}</td>
                  <td>{row.assigned_at ? "Assigned" : "Pending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-slate-300">
            Lab tools will appear here when your cohort access window begins.
          </p>
        ) : null}
      </Card>
    </AppShell>
  );
}
