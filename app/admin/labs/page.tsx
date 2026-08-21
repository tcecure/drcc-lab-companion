import { Server, UserRound } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, MetricCard } from "@/components/card";
import { LabStatusCard } from "@/components/lab-status";
import { requireManager } from "@/lib/auth";
import { getCurrentCohortNumber } from "@/lib/cohorts";
import {
  summarizePodActivity,
  type PodActivityStatus,
} from "@/lib/proxmox/activity";
import {
  getLabStatus,
  getRecentLabSnapshots,
} from "@/lib/proxmox/status";
import { createAdminClient } from "@/lib/supabase/admin";

const activityLabels: Record<PodActivityStatus, string> = {
  active: "Active",
  idle: "Idle",
  offline: "Offline",
  unknown: "Unknown",
};

function podKey(podName: string) {
  const match = /pod[-_\s]?(\d{1,2})$/i.exec(podName.trim());

  return match
    ? `pod${String(Number(match[1])).padStart(2, "0")}`
    : podName.toLowerCase();
}

export default async function AdminLabsPage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const currentCohortNumber = getCurrentCohortNumber();
  const [
    { data: settings },
    { data: instances },
    { data: assignments },
    labStatus,
    activitySnapshots,
  ] = await Promise.all([
    supabase
      .from("lab_capacity_settings")
      .select("*")
      .is("lab_track_id", null)
      .maybeSingle(),
    supabase
      .from("lab_instances")
      .select("*")
      .order("pod_name", { ascending: true }),
    supabase
      .from("student_cohort_assignments")
      .select("*")
      .eq("cohort_number", currentCohortNumber ?? -1)
      .neq("status", "cancelled")
      .not("seat_number", "is", null)
      .order("seat_number", { ascending: true }),
    getLabStatus(),
    getRecentLabSnapshots(),
  ]);
  const userIds = [
    ...new Set((assignments ?? []).map((assignment) => assignment.user_id)),
  ];
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, email, full_name, account_status")
        .in("id", userIds)
    : { data: [] };
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const assignmentBySeat = new Map(
    (assignments ?? []).flatMap((assignment) =>
      assignment.seat_number === null
        ? []
        : ([[assignment.seat_number, assignment]] as const),
    ),
  );
  const assignmentByPod = new Map(
    (assignments ?? []).flatMap((assignment) =>
      assignment.pod_name
        ? ([[podKey(assignment.pod_name), assignment]] as const)
        : [],
    ),
  );
  const instanceByPod = new Map(
    (instances ?? []).map((instance) => [
      podKey(instance.pod_name),
      instance,
    ]),
  );
  const maximumActive = settings?.maximum_active ?? 20;
  const pods = Array.from({ length: maximumActive }, (_, index) => {
    const seatNumber = index + 1;
    const suffix = String(seatNumber).padStart(2, "0");
    const podName = `Pod${suffix}`;
    const assignment = assignmentBySeat.get(seatNumber);
    const activity = assignment
      ? summarizePodActivity(activitySnapshots, podName)
      : null;

    return {
      activity,
      assignment,
      instance: instanceByPod.get(podKey(podName)),
      podName,
      profile: assignment ? profileMap.get(assignment.user_id) : null,
      seatNumber,
      suffix,
    };
  });
  const active = (instances ?? []).filter((row) =>
    ["reserved", "provisioning", "active", "expiring"].includes(row.status),
  ).length;

  return (
    <AppShell roles={roles} title="Lab Capacity">
      <AutoRefresh intervalMs={60_000} />
      <LabStatusCard status={labStatus} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          helper="Maximum active hands-on users."
          label="Active Capacity"
          value={maximumActive}
        />
        <MetricCard
          helper="Students with a pod in the active cohort."
          label="Assigned Pods"
          value={assignments?.length ?? 0}
        />
        <MetricCard
          helper="Current active or reserved lab instances."
          label="In Use"
          value={active}
        />
        <MetricCard
          helper="Standard student access window."
          label="Window"
          value={`${settings?.standard_duration_days ?? 14} days`}
        />
      </section>
      <section aria-labelledby="pod-assignments-heading">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">
              {currentCohortNumber
                ? `Active cohort ${currentCohortNumber}`
                : "No active cohort"}
            </p>
            <h2
              className="mt-2 text-xl font-semibold"
              id="pod-assignments-heading"
            >
              Student pod assignments
            </h2>
          </div>
          <p className="text-sm text-slate-400">
            {assignments?.length ?? 0} of {maximumActive} pods assigned
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {pods.map(
            ({
              activity,
              assignment,
              instance,
              podName,
              profile,
              seatNumber,
              suffix,
            }) => (
              <article
                className={`min-h-52 rounded-lg border p-4 ${
                  assignment
                    ? "border-cyan-300/25 bg-cyan-300/[0.07]"
                    : "border-white/10 bg-white/[0.025]"
                }`}
                key={podName}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-400">
                      Student {suffix}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">{podName}</h3>
                  </div>
                  {assignment && activity ? (
                    <span
                      aria-label={`${activityLabels[activity.status]}. ${activity.detail}`}
                      className={`activity-pill activity-pill-${activity.status}`}
                      title={activity.detail}
                    >
                      {activityLabels[activity.status]}
                    </span>
                  ) : (
                    <span className="status-pill">available</span>
                  )}
                </div>
                {assignment ? (
                  <>
                    <div className="mt-5 flex min-w-0 items-start gap-3">
                      <UserRound
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-cyan-200"
                        size={18}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {profile?.full_name || "Assigned student"}
                        </p>
                        <p className="mt-1 break-all text-sm text-slate-400">
                          {profile?.email || "Profile email unavailable"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">
                        {assignment.lab_username ?? `student${suffix}`}
                      </span>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="capitalize">
                          Access: {assignment.status}
                        </span>
                        <span className="capitalize">
                          {instance
                            ? `Instance: ${instance.status}`
                            : "Instance not linked"}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-5 flex items-center gap-3 text-sm text-slate-400">
                    <Server aria-hidden="true" size={18} />
                    <span>Ready for Student {String(seatNumber).padStart(2, "0")}</span>
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      </section>
      <Card eyebrow="Proxmox Inventory" title="Lab instances">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pod</th>
                <th>Status</th>
                <th>Environment</th>
                <th>Assigned User</th>
              </tr>
            </thead>
            <tbody>
              {(instances ?? []).map((row) => {
                const assignment = assignmentByPod.get(
                  podKey(row.pod_name),
                );
                const profile = assignment
                  ? profileMap.get(assignment.user_id)
                  : null;

                return (
                  <tr key={row.id}>
                    <td>{row.pod_name}</td>
                    <td>
                      <span className="status-pill">{row.status}</span>
                    </td>
                    <td>{row.environment_identifier}</td>
                    <td>
                      {profile ? (
                        <>
                          <p className="font-bold">{profile.full_name}</p>
                          <p className="text-slate-400">{profile.email}</p>
                        </>
                      ) : (
                        row.assigned_user_id ?? "Unassigned"
                      )}
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
