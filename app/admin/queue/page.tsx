import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireManager } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminQueuePage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const { data: assignments } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .order("cohort_number", { ascending: true })
    .order("seat_number", { ascending: true })
    .limit(200);
  const userIds = [...new Set((assignments ?? []).map((row) => row.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, email, full_name, organization")
        .in("id", userIds)
    : { data: [] };
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );

  return (
    <AppShell roles={roles} title="Student Queue">
      <Card eyebrow="Cohort Calendar" title="Scheduled students">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Pod</th>
                <th>Lab User</th>
                <th>Cohort</th>
                <th>Access Window</th>
                <th>Notify</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(assignments ?? []).map((row) => {
                const profile = profileMap.get(row.user_id);

                return (
                  <tr key={row.id}>
                    <td>
                      <p className="font-bold">
                        {profile?.full_name ?? "Student"}
                      </p>
                      <p className="text-slate-400">{profile?.email}</p>
                    </td>
                    <td>{row.pod_name}</td>
                    <td>{row.lab_username}</td>
                    <td>
                      #{row.cohort_number}, Seat {row.seat_number}
                    </td>
                    <td>
                      {formatDate(row.access_starts_at)} -{" "}
                      {formatDate(row.access_ends_at)}
                    </td>
                    <td>{formatDate(row.notification_send_at)}</td>
                    <td>
                      <span className="status-pill">{row.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
