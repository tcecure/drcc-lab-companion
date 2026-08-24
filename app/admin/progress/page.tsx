import { ChevronDown } from "lucide-react";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, MetricCard } from "@/components/card";
import {
  ProgressBar,
  StatusPill,
  TrainingProgressPanel,
} from "@/components/training-progress";
import { requireManager } from "@/lib/auth";
import { getCurrentCohortNumber } from "@/lib/cohorts";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPodProgress,
  summarizeCohortProgress,
  type PodProgress,
} from "@/lib/training-progress";
import type { Database } from "@/lib/types";

export const dynamic = "force-dynamic";

type Assignment = Pick<
  Database["public"]["Tables"]["student_cohort_assignments"]["Row"],
  "access_ends_at" | "pod_name" | "seat_number" | "status" | "user_id"
>;

type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "email" | "full_name" | "id"
>;

type StudentProgressRecord = {
  assignment: Assignment;
  profile: Profile | null;
  progress: PodProgress | null;
};

export default async function AdminProgressPage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const currentCohortNumber = getCurrentCohortNumber();
  const { data: assignments, error: assignmentError } = await supabase
    .from("student_cohort_assignments")
    .select("user_id, pod_name, seat_number, status, access_ends_at")
    .eq("cohort_number", currentCohortNumber ?? -1)
    .neq("status", "cancelled")
    .not("seat_number", "is", null)
    .order("seat_number", { ascending: true });

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  const userIds = (assignments ?? []).map((assignment) => assignment.user_id);
  const { data: profiles, error: profileError } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds)
    : { data: [], error: null };

  if (profileError) {
    throw new Error(profileError.message);
  }

  return (
    <AppShell roles={roles} title="Student Progress">
      <AutoRefresh intervalMs={60_000} />
      <Card
        eyebrow={
          currentCohortNumber
            ? `Active cohort ${currentCohortNumber}`
            : "No active cohort"
        }
        title="Cohort training tracker"
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Review each assigned student&apos;s verified completion percentage,
            current lab family, and module-level results. Tracker data refreshes
            automatically every minute.
          </p>
          <p className="shrink-0 text-sm font-bold text-cyan-100">
            {assignments?.length ?? 0} assigned students
          </p>
        </div>
      </Card>

      <Suspense
        fallback={
          <ProgressFallback assignmentCount={assignments?.length ?? 0} />
        }
      >
        <CohortProgress
          assignments={assignments ?? []}
          profiles={profiles ?? []}
        />
      </Suspense>
    </AppShell>
  );
}

async function CohortProgress({
  assignments,
  profiles,
}: {
  assignments: Assignment[];
  profiles: Profile[];
}) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const records: StudentProgressRecord[] = await Promise.all(
    assignments.map(async (assignment) => ({
      assignment,
      profile: profileById.get(assignment.user_id) ?? null,
      progress: await getPodProgress(assignment.pod_name),
    })),
  );
  const summary = summarizeCohortProgress(
    records.map((record) => record.progress),
  );

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          helper="Mean completion across pods currently reporting."
          label="Average Progress"
          value={
            summary.averagePercentage === null
              ? "Unavailable"
              : `${summary.averagePercentage}%`
          }
        />
        <MetricCard
          helper="Students who completed every tracked lab family."
          label="Completed"
          value={summary.completed}
        />
        <MetricCard
          helper="Students with verified work currently underway."
          label="In Progress"
          value={summary.inProgress}
        />
        <MetricCard
          helper="Students whose tracker has not recorded lab activity."
          label="Not Started"
          value={summary.notStarted}
        />
        <MetricCard
          helper="Pods that did not return a current tracker result."
          label="Unavailable"
          value={summary.unavailable}
        />
      </section>

      <section aria-labelledby="student-progress-heading">
        <div className="mb-4">
          <p className="eyebrow">Student Detail</p>
          <h2
            className="mt-2 text-xl font-semibold"
            id="student-progress-heading"
          >
            Individual progress
          </h2>
        </div>
        <div className="grid gap-3">
          {records.map((record) => (
            <StudentProgressDetails
              key={record.assignment.user_id}
              record={record}
            />
          ))}
          {records.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-400">
                No students are assigned to the active cohort.
              </p>
            </Card>
          ) : null}
        </div>
      </section>
    </>
  );
}

function StudentProgressDetails({ record }: { record: StudentProgressRecord }) {
  const { assignment, profile, progress } = record;
  const studentNumber = String(assignment.seat_number ?? 0).padStart(2, "0");
  const available = Boolean(progress && progress.status !== "unavailable");

  return (
    <details className="group overflow-hidden rounded-lg border border-cyan-200/15 bg-slate-950/55">
      <summary className="grid min-h-28 cursor-pointer list-none items-center gap-4 px-5 py-4 hover:bg-white/5 xl:grid-cols-[8rem_minmax(0,1.25fr)_minmax(12rem,0.9fr)_9rem_1.5rem] [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-xs font-bold uppercase text-cyan-100/60">
            Student {studentNumber}
          </p>
          <p className="mt-1 text-lg font-bold">
            {assignment.pod_name ?? "Pod pending"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-100">
            {profile?.full_name || "Assigned student"}
          </p>
          <p className="mt-1 truncate text-sm text-slate-400">
            {profile?.email || "Profile email unavailable"}
          </p>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-400">
              {available
                ? `${progress?.completedModules} of ${progress?.totalModules} complete`
                : "No current tracker result"}
            </span>
            <span className="font-bold">
              {available ? `${progress?.overallPercentage}%` : "--"}
            </span>
          </div>
          <ProgressBar
            label={`Student ${studentNumber} overall progress`}
            percentage={available ? (progress?.overallPercentage ?? 0) : 0}
            status={
              available ? (progress?.status ?? "not_started") : "unavailable"
            }
          />
        </div>
        <div className="flex flex-col items-start gap-2 xl:items-end">
          {progress ? (
            <StatusPill status={progress.status} />
          ) : (
            <span className="status-pill">Unavailable</span>
          )}
          <span className="text-xs text-slate-400">
            {available ? formatDateTime(progress?.checkedAt) : "Check pending"}
          </span>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="text-slate-400 transition-transform group-open:rotate-180"
          size={18}
        />
      </summary>
      <div className="border-t border-cyan-200/10 bg-slate-950/30 p-5 sm:p-6">
        {progress ? (
          <TrainingProgressPanel progress={progress} />
        ) : (
          <p className="text-sm leading-6 text-slate-300">
            This assignment does not have a valid pod link yet, so tracker
            details are unavailable.
          </p>
        )}
      </div>
    </details>
  );
}

function ProgressFallback({ assignmentCount }: { assignmentCount: number }) {
  return (
    <Card eyebrow="Tracker Sync" title="Loading student progress">
      <div aria-busy="true" className="grid gap-3">
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-white/10" />
        <div className="h-2 w-full animate-pulse rounded-full bg-white/10" />
        <p className="text-sm text-slate-400">
          Checking {assignmentCount} assigned pods in parallel.
        </p>
      </div>
    </Card>
  );
}
