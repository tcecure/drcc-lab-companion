import Link from "next/link";
import { ArrowRight } from "lucide-react";

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
    { count: supportTickets },
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
      .from("support_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "in_progress"]),
    supabase
      .from("lab_capacity_settings")
      .select("maximum_active, maximum_reserved, standard_duration_days")
      .is("lab_track_id", null)
      .maybeSingle(),
    getLabStatus(),
  ]);
  const active = (notifiedStudents ?? 0) + (activeStudents ?? 0);

  return (
    <AppShell roles={roles} title="Operations Overview">
      <LabStatusCard status={labStatus} />
      <section className="dashboard-metrics">
        <MetricCard
          helper="Students notified or inside an active access window."
          label="Active Students"
          value={active}
        />
        <MetricCard
          helper="Waiting for an upcoming cohort assignment."
          label="Queued Students"
          value={queuedStudents ?? 0}
        />
        <MetricCard
          helper={`${capacity?.standard_duration_days ?? 14}-day window with ${capacity?.maximum_reserved ?? 20} reserved slots.`}
          label="Lab Capacity"
          value={`${active} / ${capacity?.maximum_active ?? 20}`}
        />
        <MetricCard
          helper="New or active student issues that need staff attention."
          href="/admin/support"
          label="Support Tickets"
          value={supportTickets ?? 0}
        />
      </section>
      <section className="dashboard-section-grid">
        <Card title="Student operations">
          <p className="section-summary">
            Manage intake, assignments, and student progress from one place.
          </p>
          <div className="dashboard-action-list">
            <Action
              detail={`${labRequests ?? 0} submitted, queued, or on hold`}
              href="/admin/approvals"
              label="Review lab requests"
            />
            <Action
              detail={`${queuedStudents ?? 0} students awaiting placement`}
              href="/admin/queue"
              label="Manage the student queue"
            />
            <Action
              detail="Review completion status across active pods"
              href="/admin/progress"
              label="View student progress"
            />
            <Action
              detail="Add current students or prepare a future cohort"
              href="/admin/import"
              label="Import students"
            />
          </div>
        </Card>
        <Card title="Today’s priorities">
          <p className="section-summary">
            Open the operational areas most likely to need attention.
          </p>
          <div className="dashboard-action-list">
            <Action
              detail={`${supportTickets ?? 0} open or in-progress conversations`}
              href="/admin/support"
              label="Respond to support tickets"
            />
            <Action
              detail="Inspect hosts, domain controllers, and pod health"
              href="/admin/lab-status"
              label="Review lab status"
            />
            <Action
              detail="Confirm student seats and current pod assignments"
              href="/admin/labs"
              label="Check lab capacity"
            />
            <Action
              detail="Review the same published guidance students use"
              href="/admin/guides"
              label="Open current lab guides"
            />
          </div>
        </Card>
      </section>
    </AppShell>
  );
}

function Action({
  detail,
  href,
  label,
}: {
  detail: string;
  href: string;
  label: string;
}) {
  return (
    <Link className="dashboard-action" href={href}>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <ArrowRight aria-hidden="true" size={17} />
    </Link>
  );
}
