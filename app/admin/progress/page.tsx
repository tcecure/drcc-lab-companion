import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { StudentRating } from "@/components/student-rating";
import { requireManager } from "@/lib/auth";
import { listCohortRatings } from "@/lib/cohort-ratings";
import {
  buildCohortStandings,
  fetchLiveCohortSnapshot,
  getStoredCohortSnapshot,
  listStoredCohortSnapshots,
  summarizeStandings,
  type CohortSnapshot,
  type StandingRow,
} from "@/lib/cohort-progress";
import { getCohortSchedule, getCurrentCohortNumber } from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPodTrackerPageUrl,
  podNumberFromPodName,
} from "@/lib/training-progress";

export const dynamic = "force-dynamic";

type AdminProgressPageProps = {
  searchParams: Promise<{ cohort?: string; error?: string; pod?: string }>;
};

const statusLabels: Record<StandingRow["status"], string> = {
  completed: "Completed all",
  in_progress: "In progress",
  not_started: "Not started",
  unavailable: "No data",
};

const statusStyles: Record<StandingRow["status"], string> = {
  completed: "bg-emerald-400/10 text-emerald-200",
  in_progress: "bg-cyan-300/10 text-cyan-100",
  not_started: "bg-amber-300/10 text-amber-100",
  unavailable: "bg-white/5 text-slate-300",
};

function formatWindow(cohortNumber: number) {
  const schedule = getCohortSchedule(cohortNumber);
  const format = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    });

  return `${format(schedule.accessStartsAt)} – ${format(schedule.accessEndsAt)}`;
}

function cohortEyebrow(
  shownCohortNumber: number | null,
  isActive: boolean,
  snapshot: CohortSnapshot | null,
) {
  if (shownCohortNumber === null) {
    return "No cohort data";
  }

  if (isActive) {
    return `Cohort ${shownCohortNumber} · active · ${formatWindow(shownCohortNumber)}`;
  }

  return `Cohort ${shownCohortNumber} · ${
    snapshot?.status === "final" ? "final snapshot" : "snapshot"
  } · ${formatWindow(shownCohortNumber)}`;
}

export default async function AdminProgressPage({
  searchParams,
}: AdminProgressPageProps) {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const env = readServerEnv();
  const currentCohortNumber = getCurrentCohortNumber();
  const { data: allAssignments, error: assignmentError } = await supabase
    .from("student_cohort_assignments")
    .select("user_id, pod_name, seat_number, status, cohort_number")
    .neq("status", "cancelled")
    .not("seat_number", "is", null)
    .order("cohort_number", { ascending: false })
    .order("seat_number", { ascending: true });

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  const storedSnapshots = await listStoredCohortSnapshots();
  // Every cohort that has seats or a stored snapshot gets a tab, so a finished
  // cohort stays reachable once the pods have been reset for the next one.
  const cohortNumbers = [
    ...new Set([
      ...(currentCohortNumber ? [currentCohortNumber] : []),
      ...(allAssignments ?? []).map((assignment) => assignment.cohort_number),
      ...storedSnapshots.map((snapshot) => snapshot.cohort_number),
    ]),
  ].sort((left, right) => right - left);
  const params = await searchParams;
  const requestedCohort = Number(params.cohort);
  const shownCohortNumber = cohortNumbers.includes(requestedCohort)
    ? requestedCohort
    : (cohortNumbers.find(
        (cohortNumber) => cohortNumber === currentCohortNumber,
      ) ??
      cohortNumbers[0] ??
      null);
  const isActive =
    shownCohortNumber !== null && shownCohortNumber === currentCohortNumber;
  const assignments = (allAssignments ?? []).filter(
    (assignment) => assignment.cohort_number === shownCohortNumber,
  );
  const userIds = assignments.map((assignment) => assignment.user_id);
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
  const roster = assignments.map((assignment) => {
    const profile = profileById.get(assignment.user_id) ?? null;

    return {
      podName: assignment.pod_name,
      userId: assignment.user_id,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });
  // The active cohort is graded live; a finished cohort only exists as the
  // snapshot taken while its students were still in the pods.
  const storedSnapshot = shownCohortNumber
    ? await getStoredCohortSnapshot(shownCohortNumber)
    : null;
  const snapshot =
    isActive && shownCohortNumber
      ? ((await fetchLiveCohortSnapshot(
          shownCohortNumber,
          env.TRAINING_TRACKER_BASE_URL,
        )) ?? storedSnapshot)
      : storedSnapshot;
  const standings = buildCohortStandings(snapshot, roster);
  // A rating is staff judgement on a finished cohort, so the active cohort
  // shows nothing to set yet.
  const ratings = await listCohortRatings(shownCohortNumber);
  const summary = summarizeStandings(standings);
  const requestedPod = podNumberFromPodName(
    params.pod ? `Pod${params.pod}` : null,
  );
  const selectedPod = standings.some(
    (student) => student.podNumber === requestedPod,
  )
    ? requestedPod
    : (standings[0]?.podNumber ?? null);
  const selectedStudent = standings.find(
    (student) => student.podNumber === selectedPod,
  );
  const trackerUrl = getPodTrackerPageUrl(
    selectedStudent?.podName,
    env.TRAINING_TRACKER_BASE_URL,
  );
  const capturedAt = snapshot?.trackerLastRun ?? snapshot?.capturedAt ?? null;
  // One column per family present anywhere in the cohort, so a pod that is
  // missing a family still lines up under the right headings.
  const familyCodes = [
    ...new Set(
      standings.flatMap((student) =>
        student.families.map((family) => family.code),
      ),
    ),
  ];

  return (
    <AppShell roles={roles} title="Student Progress">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      <Card
        eyebrow={cohortEyebrow(shownCohortNumber, isActive, snapshot)}
        title={isActive ? "Live training tracker" : "Cohort snapshot"}
      >
        <nav
          aria-label="Cohorts"
          className="flex flex-wrap gap-2 border-b border-white/10 pb-4"
        >
          {cohortNumbers.map((cohortNumber) => {
            const selected = cohortNumber === shownCohortNumber;

            return (
              <Link
                aria-current={selected ? "page" : undefined}
                className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
                  selected
                    ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-100"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan-200/25 hover:bg-white/[0.06]"
                }`}
                href={`/admin/progress?cohort=${cohortNumber}`}
                key={cohortNumber}
              >
                Cohort {cohortNumber}
                <span className="ml-2 text-xs font-medium uppercase text-slate-400">
                  {cohortNumber === currentCohortNumber ? "Active" : "Snapshot"}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            {isActive
              ? "Standings come from the live AWX tracker and change as students work. Select a student to open that pod's tracker."
              : "This cohort's pods have since been reset for a later cohort, so these standings are the snapshot taken while its students still held the pods."}
          </p>
          <p className="shrink-0 text-sm font-bold text-cyan-100">
            {summary.labsCompleted}/{summary.labsTotal} labs ·{" "}
            {summary.students} students
          </p>
        </div>
        {capturedAt ? (
          <p className="mt-3 text-xs text-slate-400">
            {isActive ? "Last verified" : "Captured"}{" "}
            {new Date(capturedAt).toLocaleString("en-US", {
              timeZone: "America/New_York",
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {snapshot?.waivedLabs.length
              ? ` · scored without the waived ${snapshot.waivedLabs.join(", ")} lab${
                  snapshot.waivedLabs.length > 1 ? "s" : ""
                }`
              : null}
          </p>
        ) : null}
      </Card>

      {standings.length ? (
        <Card
          eyebrow="Standings"
          title={`${summary.completedAll} completed · ${summary.inProgress} in progress · ${summary.notStarted} not started${
            summary.unavailable ? ` · ${summary.unavailable} without data` : ""
          }`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="text-xs font-bold uppercase text-cyan-100/60">
                <tr>
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Student</th>
                  <th className="py-2 pr-4">Rating</th>
                  <th className="py-2 pr-4">Pod</th>
                  <th className="py-2 pr-4">Labs</th>
                  {familyCodes.map((code) => (
                    <th className="py-2 pr-4" key={code}>
                      {code}
                    </th>
                  ))}
                  <th className="py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {standings.map((student, index) => (
                  <tr key={student.podNumber}>
                    <td className="py-3 pr-4 text-slate-400">{index + 1}</td>
                    <td className="py-3 pr-4">
                      <Link
                        className="font-bold text-slate-100 hover:text-cyan-200"
                        href={`/admin/progress?cohort=${shownCohortNumber}&pod=${student.podNumber}`}
                        scroll={false}
                      >
                        {student.fullName || `Student ${student.podNumber}`}
                      </Link>
                      <span className="mt-1 block truncate text-xs text-slate-400">
                        {student.email || "Email unavailable"}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <StudentRating
                        cohortNumber={shownCohortNumber ?? 0}
                        editable={!isActive}
                        fullName={
                          student.fullName || `Student ${student.podNumber}`
                        }
                        rating={
                          student.userId
                            ? (ratings.get(student.userId) ?? null)
                            : null
                        }
                        userId={student.userId}
                      />
                    </td>
                    <td className="py-3 pr-4 text-slate-300">
                      {student.podName}
                    </td>
                    <td className="py-3 pr-4 font-bold text-cyan-100">
                      {student.completed}/{student.total}
                    </td>
                    {familyCodes.map((code) => {
                      const family = student.families.find(
                        (candidate) => candidate.code === code,
                      );

                      return (
                        <td className="py-3 pr-4 text-slate-300" key={code}>
                          {family ? `${family.completed}/${family.total}` : "—"}
                        </td>
                      );
                    })}
                    <td className="py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${statusStyles[student.status]}`}
                      >
                        {statusLabels[student.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {selectedStudent && isActive && trackerUrl ? (
        <section className="grid items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <nav
            aria-label="Assigned students"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:sticky xl:top-6 xl:grid-cols-1"
          >
            {standings.map((student) => {
              const selected = student.podNumber === selectedPod;

              return (
                <Link
                  aria-current={selected ? "page" : undefined}
                  className={`min-w-0 rounded-lg border px-3 py-3 transition ${
                    selected
                      ? "border-cyan-300/45 bg-cyan-300/10"
                      : "border-white/10 bg-white/[0.03] hover:border-cyan-200/25 hover:bg-white/[0.06]"
                  }`}
                  href={`/admin/progress?cohort=${shownCohortNumber}&pod=${student.podNumber}`}
                  key={student.podNumber}
                  scroll={false}
                >
                  <span className="block text-xs font-bold uppercase text-cyan-100/60">
                    Student {student.podNumber} · {student.podName}
                  </span>
                  <span className="mt-1 block truncate text-sm font-bold text-slate-100">
                    {student.fullName || "Assigned student"}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-400">
                    {student.email || "Email unavailable"}
                  </span>
                </Link>
              );
            })}
          </nav>

          <section className="overflow-hidden rounded-lg border border-cyan-200/15 bg-slate-950/55">
            <header className="flex flex-col justify-between gap-4 border-b border-cyan-200/10 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <p className="eyebrow">{selectedStudent.podName} Tracker</p>
                <h2 className="mt-2 text-xl font-semibold">
                  {selectedStudent.fullName || `Student ${selectedPod}`}
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
      ) : null}

      {selectedStudent && !isActive ? (
        <Card
          eyebrow={`${selectedStudent.podName} · ${selectedStudent.completed}/${selectedStudent.total} labs`}
          title={selectedStudent.fullName || `Student ${selectedPod}`}
        >
          {selectedStudent.incompleteLabs.length ? (
            <ul className="space-y-3">
              {selectedStudent.incompleteLabs.map((lab) => (
                <li
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3"
                  key={`${lab.code}-${lab.labId}`}
                >
                  <p className="text-sm font-bold text-slate-100">
                    {lab.code} {lab.labId}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    {lab.reason || "No verifier detail recorded."}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-6 text-slate-300">
              {selectedStudent.status === "unavailable"
                ? "No results were captured for this pod in this cohort, so there is nothing to score."
                : "Every graded lab was completed in this cohort."}
            </p>
          )}
        </Card>
      ) : null}

      {standings.length === 0 ? (
        <Card eyebrow="Student Detail" title="No assigned tracker">
          <p className="text-sm leading-6 text-slate-300">
            {shownCohortNumber
              ? `Cohort ${shownCohortNumber} has no student with a pod assignment.`
              : "No cohort has a student with a pod assignment yet."}{" "}
            Every pod is still graded automatically, so the trackers below stay
            available.
          </p>
          <nav
            aria-label="Pod trackers"
            className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5"
          >
            {Array.from({ length: 20 }, (_, index) =>
              String(index + 1).padStart(2, "0"),
            ).map((podNumber) => (
              <a
                className="button secondary justify-center"
                href={
                  getPodTrackerPageUrl(
                    `Pod${podNumber}`,
                    env.TRAINING_TRACKER_BASE_URL,
                  ) ?? undefined
                }
                key={podNumber}
                rel="noreferrer"
                target="_blank"
              >
                Pod{podNumber}
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            ))}
          </nav>
        </Card>
      ) : null}
    </AppShell>
  );
}
