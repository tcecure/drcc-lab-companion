import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Card, MetricCard } from "@/components/card";
import { getProfile, getUserRoles, requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function StudentPage() {
  const user = await requireUser();
  const [roles, profile] = await Promise.all([
    getUserRoles(user.id),
    getProfile(user.id),
  ]);
  const supabase = await createClient();
  const { data: assignment } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <AppShell roles={roles} title="Student Dashboard">
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          helper="Your current lab cohort status."
          label="Queue Status"
          value={assignment?.status ?? "Not queued"}
        />
        <MetricCard
          helper="Assigned lab seat for hands-on access."
          label="Seat"
          value={
            assignment
              ? `${assignment.cohort_number}-${assignment.seat_number}`
              : "Pending"
          }
        />
        <MetricCard
          helper="Standard completion window once access begins."
          label="Access Window"
          value="14 days"
        />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Card eyebrow="Account" title="Profile summary">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-400">Name</dt>
              <dd className="font-bold">{profile?.full_name || user.email}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Status</dt>
              <dd className="font-bold capitalize">
                {profile?.account_status ?? "active"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Organization</dt>
              <dd className="font-bold">
                {profile?.organization || "DigitalRCC Student"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Roles</dt>
              <dd className="font-bold">{roles.join(", ") || "student"}</dd>
            </div>
          </dl>
        </Card>
        <Card eyebrow="Cohort Window" title="Hands-on access">
          <p className="text-sm leading-6 text-slate-300">
            {assignment
              ? `Your access window is ${formatDate(assignment.access_starts_at)} through ${formatDate(assignment.access_ends_at)}.`
              : "Your access window will appear here after you are assigned to a cohort."}
          </p>
          <Link className="button mt-5" href="/student/guides">
            Open lab guides
          </Link>
        </Card>
      </section>
    </AppShell>
  );
}
