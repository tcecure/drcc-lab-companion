import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import { runCohortAssignmentAction } from "@/lib/actions/import-students";
import { requireManager } from "@/lib/auth";
import { formatCohortStartDate, getCohortSchedule } from "@/lib/cohorts";
import { formatDate, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

type QueuePageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function AdminQueuePage({ searchParams }: QueuePageProps) {
  const { roles } = await requireManager();
  const params = await searchParams;
  const supabase = createAdminClient();
  const { data: assignments } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .order("cohort_number", { ascending: true })
    .order("created_at", { ascending: true })
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
  const awaitingNumbers = (assignments ?? []).filter(
    (row) => row.seat_number === null && row.status !== "cancelled",
  ).length;

  return (
    <AppShell roles={roles} title="Student Queue">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.message}
        </p>
      ) : null}
      <Card eyebrow="Student Numbers" title="Assignment schedule">
        <p className="text-sm leading-6 text-slate-300">
          {awaitingNumbers} student{awaitingNumbers === 1 ? "" : "s"} waiting
          for a number. Numbers are assigned automatically at 1:00 AM Eastern on
          each cohort start date; use the button only to catch up a missed run.
        </p>
        <form action={runCohortAssignmentAction} className="mt-5">
          <SubmitButton>Run assignment now</SubmitButton>
        </form>
      </Card>
      <Card eyebrow="Cohort Calendar" title="Scheduled students">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Cohort</th>
                <th>Student Number</th>
                <th>Pod</th>
                <th>Lab User</th>
                <th>Access Window</th>
                <th>Numbers Assigned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(assignments ?? []).map((row) => {
                const profile = profileMap.get(row.user_id);
                const schedule = getCohortSchedule(row.cohort_number);

                return (
                  <tr key={row.id}>
                    <td>
                      <p className="font-bold">
                        {profile?.full_name ?? "Student"}
                      </p>
                      <p className="text-slate-400">{profile?.email}</p>
                    </td>
                    <td>
                      #{row.cohort_number}
                      <p className="text-slate-400">
                        {formatCohortStartDate(schedule.startDate)}
                      </p>
                    </td>
                    <td>{row.seat_number ?? "Pending"}</td>
                    <td>{row.pod_name ?? "Pending"}</td>
                    <td>{row.lab_username ?? "Pending"}</td>
                    <td>
                      {formatDate(row.access_starts_at)} -{" "}
                      {formatDate(row.access_ends_at)}
                    </td>
                    <td>{formatDateTime(schedule.assignmentRunAt)}</td>
                    <td>
                      <span className="status-pill">
                        {row.seat_number === null && row.status === "queued"
                          ? "awaiting number"
                          : row.status}
                      </span>
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
