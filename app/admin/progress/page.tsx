import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireManager } from "@/lib/auth";
import { getCurrentCohortNumber } from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPodTrackerPageUrl,
  podNumberFromPodName,
} from "@/lib/training-progress";

export const dynamic = "force-dynamic";

type AdminProgressPageProps = {
  searchParams: Promise<{ pod?: string }>;
};

export default async function AdminProgressPage({
  searchParams,
}: AdminProgressPageProps) {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const env = readServerEnv();
  const currentCohortNumber = getCurrentCohortNumber();
  const { data: assignments, error: assignmentError } = await supabase
    .from("student_cohort_assignments")
    .select("user_id, pod_name, seat_number, status")
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

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const roster = (assignments ?? []).flatMap((assignment) => {
    const podNumber = podNumberFromPodName(assignment.pod_name);

    return podNumber
      ? [
          {
            assignment,
            podNumber,
            profile: profileById.get(assignment.user_id) ?? null,
          },
        ]
      : [];
  });
  const params = await searchParams;
  const requestedPod = podNumberFromPodName(
    params.pod ? `Pod${params.pod}` : null,
  );
  const selectedPod = roster.some(
    (student) => student.podNumber === requestedPod,
  )
    ? requestedPod
    : (roster[0]?.podNumber ?? null);
  const selectedStudent = roster.find(
    (student) => student.podNumber === selectedPod,
  );
  const trackerUrl = getPodTrackerPageUrl(
    selectedStudent?.assignment.pod_name,
    env.TRAINING_TRACKER_BASE_URL,
  );

  return (
    <AppShell roles={roles} title="Student Progress">
      <Card
        eyebrow={
          currentCohortNumber
            ? `Active cohort ${currentCohortNumber}`
            : "No active cohort"
        }
        title="Live training tracker"
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Select an assigned student to open that pod&apos;s existing training
            tracker. Progress, module status, and verification details are shown
            directly from the tracker system.
          </p>
          <p className="shrink-0 text-sm font-bold text-cyan-100">
            {roster.length} assigned students
          </p>
        </div>
      </Card>

      {selectedStudent && trackerUrl ? (
        <section className="grid items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <nav
            aria-label="Assigned students"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:sticky xl:top-6 xl:grid-cols-1"
          >
            {roster.map((student) => {
              const selected = student.podNumber === selectedPod;

              return (
                <Link
                  aria-current={selected ? "page" : undefined}
                  className={`min-w-0 rounded-lg border px-3 py-3 transition ${
                    selected
                      ? "border-cyan-300/45 bg-cyan-300/10"
                      : "border-white/10 bg-white/[0.03] hover:border-cyan-200/25 hover:bg-white/[0.06]"
                  }`}
                  href={`/admin/progress?pod=${student.podNumber}`}
                  key={student.assignment.user_id}
                  scroll={false}
                >
                  <span className="block text-xs font-bold uppercase text-cyan-100/60">
                    Student {student.podNumber} · Pod{student.podNumber}
                  </span>
                  <span className="mt-1 block truncate text-sm font-bold text-slate-100">
                    {student.profile?.full_name || "Assigned student"}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-400">
                    {student.profile?.email || "Email unavailable"}
                  </span>
                </Link>
              );
            })}
          </nav>

          <section className="overflow-hidden rounded-lg border border-cyan-200/15 bg-slate-950/55">
            <header className="flex flex-col justify-between gap-4 border-b border-cyan-200/10 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <p className="eyebrow">Pod{selectedPod} Tracker</p>
                <h2 className="mt-2 text-xl font-semibold">
                  {selectedStudent.profile?.full_name ||
                    `Student ${selectedPod}`}
                </h2>
              </div>
              <a
                className="button secondary shrink-0"
                href={trackerUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open tracker
                <ExternalLink aria-hidden="true" size={16} />
              </a>
            </header>
            <iframe
              className="h-[calc(100vh-8rem)] min-h-[48rem] w-full bg-gray-950"
              key={trackerUrl}
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
              src={trackerUrl}
              title={`Training tracker for Student ${selectedPod}`}
            />
          </section>
        </section>
      ) : (
        <Card eyebrow="Student Detail" title="No assigned tracker">
          <p className="text-sm leading-6 text-slate-300">
            No student with a valid pod assignment is available in the active
            cohort.
          </p>
        </Card>
      )}
    </AppShell>
  );
}
