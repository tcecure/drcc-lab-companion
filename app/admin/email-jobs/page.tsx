import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireManager } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function EmailJobsPage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <AppShell roles={roles} title="Email Jobs">
      <Card eyebrow="Delivery Queue" title="Recent email jobs">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((job) => (
                <tr key={job.id}>
                  <td>{job.recipient}</td>
                  <td>{job.subject}</td>
                  <td>
                    <span className="status-pill">{job.status}</span>
                  </td>
                  <td>{formatDateTime(job.requested_at)}</td>
                  <td className="text-rose-100">{job.error_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
