import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function StudentQueuePage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <AppShell roles={roles} title="Queue Status">
      <Card eyebrow="Your Cohort" title="Lab access schedule">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Pod</th>
                <th>Seat</th>
                <th>Window</th>
                <th>Notification</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.cohort_number}</td>
                  <td>{row.pod_name}</td>
                  <td>{row.seat_number}</td>
                  <td>
                    {formatDate(row.access_starts_at)} -{" "}
                    {formatDate(row.access_ends_at)}
                  </td>
                  <td>{formatDateTime(row.notification_send_at)}</td>
                  <td>
                    <span className="status-pill">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
