import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Card, MetricCard } from "@/components/card";
import { LabStatusCard } from "@/components/lab-status";
import { requireManager } from "@/lib/auth";
import { getLabStatus } from "@/lib/proxmox/status";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminPage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const [
    { count: queuedStudents },
    { count: notifiedStudents },
    { count: activeStudents },
    { count: labRequests },
    { data: capacity },
    labStatus,
  ] = await Promise.all([
    supabase
      .from("student_cohort_assignments")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued"),
    supabase
      .from("student_cohort_assignments")
      .select("id", { count: "exact", head: true })
      .eq("status", "notified"),
    supabase
      .from("student_cohort_assignments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("lab_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "queued", "on_hold"]),
    supabase
      .from("lab_capacity_settings")
      .select("maximum_active, maximum_reserved, standard_duration_days")
      .is("lab_track_id", null)
      .maybeSingle(),
    getLabStatus(),
  ]);
  const active = (notifiedStudents ?? 0) + (activeStudents ?? 0);

  return (
    <AppShell roles={roles} title="Admin Overview">
      <LabStatusCard status={labStatus} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          helper="Students queued and waiting for a student number."
          label="Queue Status"
          value={queuedStudents ? `${queuedStudents} waiting` : "No waitlist"}
        />
        <MetricCard
          helper="Students notified or inside an active access window."
          label="Active Students"
          value={active}
        />
        <MetricCard
          helper="Awaiting the 1:00 AM Eastern assignment run."
          label="Queued Students"
          value={queuedStudents ?? 0}
        />
        <MetricCard
          helper={`${capacity?.standard_duration_days ?? 14}-day window with ${capacity?.maximum_reserved ?? 20} reserved slots.`}
          label="Lab Capacity"
          value={`${active} / ${capacity?.maximum_active ?? 20}`}
        />
        <MetricCard
          helper="Submitted, queued, or on-hold hands-on lab requests."
          label="Lab Request"
          value={labRequests ?? 0}
        />
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <Card eyebrow="Student Operations" title="Queue and Intake">
          <div className="grid gap-3 sm:grid-cols-2">
            <Action href="/admin/import" label="Import students" />
            <Action href="/admin/queue" label="Student queue" />
            <Action href="/admin/approvals" label="Approvals" />
            <Action href="/admin/email-jobs" label="Email jobs" />
          </div>
        </Card>
        <Card eyebrow="Lab Operations" title="Environment Controls">
          <div className="grid gap-3 sm:grid-cols-2">
            <Action href="/admin/labs" label="Lab capacity" />
            <Action href="/student/guides" label="Lab guides" />
            <Action href="/student/labs" label="Student labs" />
            <Action href="/student/support" label="Support" />
          </div>
        </Card>
      </section>
    </AppShell>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="rounded-lg border border-cyan-200/15 bg-white/[0.05] px-4 py-3 text-sm font-bold text-cyan-100 hover:bg-white/[0.08]"
      href={href}
    >
      {label}
    </Link>
  );
}
