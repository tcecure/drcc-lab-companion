import Link from "next/link";
import { ArrowDownAZ, ArrowUpZA, RefreshCw } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import { syncMoodleNowAction } from "@/lib/actions/moodle-sync";
import { formatDateTime } from "@/lib/format";
import {
  buildRosterHref,
  describeCompletion,
  describeSyncFreshness,
  rosterPageSizes,
  type ImpactMetricsRow,
  type RosterParams,
} from "@/lib/moodle/impact";
import type { RosterEntry, TrackedCourseOption } from "@/lib/moodle/queries";

export const donorHeadline = "DigitalRCC Community Impact";
export const donorSummary =
  "DigitalRCC provides practical cybersecurity education and hands-on learning opportunities that help individuals build skills, confidence and career readiness.";

const metricDefinitions = {
  completed:
    "Course enrollments Moodle reports as completed. The rate compares completed enrollments with the enrollments Moodle tracks completion for.",
  current:
    "Distinct students with an active, non-suspended enrollment in a currently open tracked course. This is course participation, not who is signed in right now.",
  enrolled:
    "Distinct Moodle student accounts ever seen in at least one tracked DigitalRCC course, counted once by Moodle user ID. Staff, service and test accounts are excluded.",
  enrollments:
    "Distinct student-and-course pairs ever seen. One student in one course counts once, no matter how often we synchronize.",
};

function ImpactCard({
  helper,
  label,
  value,
}: {
  helper: string;
  label: string;
  value: string;
}) {
  return (
    <Card eyebrow="Moodle-derived">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold">{label}</h3>
        <p className="text-3xl font-bold">{value}</p>
      </div>
      <p className="mt-5 text-sm leading-6 text-slate-300">{helper}</p>
    </Card>
  );
}

export function ImpactCards({
  metrics,
  showDefinitions = true,
}: {
  metrics: ImpactMetricsRow;
  showDefinitions?: boolean;
}) {
  const completion = describeCompletion(metrics);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <ImpactCard
        helper={
          showDefinitions
            ? metricDefinitions.enrolled
            : "Since our first tracked course."
        }
        label="Students Enrolled — All Time"
        value={String(metrics.studentsEnrolledAllTime)}
      />
      <ImpactCard
        helper={
          showDefinitions
            ? metricDefinitions.current
            : "Students learning with us today."
        }
        label="Currently Taking Courses"
        value={String(metrics.currentlyTakingCourses)}
      />
      <ImpactCard
        helper={
          showDefinitions
            ? metricDefinitions.enrollments
            : "Every course seat taken by a student."
        }
        label="Total Course Enrollments"
        value={String(metrics.totalCourseEnrollments)}
      />
      <ImpactCard
        helper={
          completion.available
            ? `${completion.label}${showDefinitions ? `. ${metricDefinitions.completed}` : "."}`
            : "Moodle completion tracking is not reporting for these courses yet."
        }
        label="Courses Completed"
        value={completion.value}
      />
    </div>
  );
}

export function CredibilityPanel({
  metrics,
  now,
}: {
  metrics: ImpactMetricsRow;
  now?: Date;
}) {
  const freshness = describeSyncFreshness(metrics.lastSuccessfulSyncAt, now);
  const stateLabel = {
    current: "Current",
    delayed: "Delayed",
    unavailable: "Unavailable",
  }[freshness.state];

  return (
    <Card eyebrow="Where these numbers come from" title="Data credibility">
      <dl className="grid gap-4 text-sm leading-6 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Moodle synchronization status</dt>
          <dd className="text-slate-300">
            {stateLabel}. {freshness.detail}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Last successful synchronization</dt>
          <dd className="text-slate-300">
            {metrics.lastSuccessfulSyncAt
              ? formatDateTime(metrics.lastSuccessfulSyncAt)
              : "None yet"}
            {metrics.lastFailedSyncAt
              ? ` (last failure ${formatDateTime(metrics.lastFailedSyncAt)})`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Earliest date represented</dt>
          <dd className="text-slate-300">
            {metrics.earliestObservedAt
              ? `${formatDateTime(metrics.earliestObservedAt)} — all time from available Moodle records`
              : "All time from available Moodle records"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Tracked courses and portal matching</dt>
          <dd className="text-slate-300">
            {metrics.trackedCourses} tracked course
            {metrics.trackedCourses === 1 ? "" : "s"}; {metrics.matchedLearners}{" "}
            learners matched to a portal account, {metrics.unmatchedLearners}{" "}
            unmatched, {metrics.conflictLearners} needing review.
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export function RosterControls({
  courses,
  params,
  returnTo,
}: {
  courses: TrackedCourseOption[];
  params: RosterParams;
  returnTo: string;
}) {
  const oppositeDirection = params.direction === "asc" ? "desc" : "asc";

  return (
    <Card eyebrow="Student roster" title="Find a student">
      <form
        action="/admin/community-impact"
        className="grid gap-4 md:grid-cols-5"
      >
        <label className="flex flex-col gap-2 text-sm md:col-span-2">
          <span className="font-semibold">Search by name</span>
          <input
            className="input"
            defaultValue={params.search}
            name="q"
            placeholder="Last or first name"
            type="search"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Course</span>
          <select
            className="input"
            defaultValue={params.courseId ? String(params.courseId) : ""}
            name="course"
          >
            <option value="">All tracked courses</option>
            {courses.map((course) => (
              <option key={course.moodleCourseId} value={course.moodleCourseId}>
                {course.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Enrollment</span>
          <select className="input" defaultValue={params.status} name="status">
            <option value="all">Any status</option>
            <option value="active">Active enrollment</option>
            <option value="inactive">No active enrollment</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Completion</span>
          <select
            className="input"
            defaultValue={params.completion}
            name="completion"
          >
            <option value="all">Any completion</option>
            <option value="complete">Completed a course</option>
            <option value="incomplete">No completions yet</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Rows per page</span>
          <select
            className="input"
            defaultValue={String(params.pageSize)}
            name="pageSize"
          >
            {rosterPageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <input name="dir" type="hidden" value={params.direction} />
        <div className="flex items-end gap-3 md:col-span-2">
          <SubmitButton>Apply</SubmitButton>
          <Link className="button secondary" href="/admin/community-impact">
            Reset
          </Link>
        </div>
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          className="button secondary"
          href={buildRosterHref(params, {
            direction: oppositeDirection,
            page: 1,
          })}
        >
          {params.direction === "asc" ? (
            <ArrowUpZA aria-hidden="true" size={17} />
          ) : (
            <ArrowDownAZ aria-hidden="true" size={17} />
          )}
          Sort last name {params.direction === "asc" ? "Z–A" : "A–Z"}
        </Link>
        <span className="text-sm text-slate-400">
          Sorted {params.direction === "asc" ? "A–Z" : "Z–A"} by last name, then
          first name.
        </span>
        <form action={syncMoodleNowAction} className="ml-auto">
          <input name="returnTo" type="hidden" value={returnTo} />
          <SubmitButton>
            <RefreshCw aria-hidden="true" size={17} />
            Sync now
          </SubmitButton>
        </form>
      </div>
    </Card>
  );
}

export function RosterTable({
  entries,
  params,
  total,
}: {
  entries: RosterEntry[];
  params: RosterParams;
  total: number;
}) {
  const { page, pageSize } = params;
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const hasNext = page * pageSize < total;

  return (
    <Card
      eyebrow="Moodle roster"
      title={`${total} student${total === 1 ? "" : "s"}`}
    >
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Last name</th>
              <th>First name</th>
              <th>Portal match</th>
              <th>Moodle email</th>
              <th>Courses</th>
              <th>Enrollment</th>
              <th>Last course activity</th>
              <th>Progress</th>
              <th>Enrolled</th>
              <th>Completed</th>
              <th>Completion date</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.moodle_user_id}>
                <td className="font-bold">{entry.last_name || "—"}</td>
                <td>{entry.first_name || "—"}</td>
                <td>
                  <span className="status-pill">{entry.match_status}</span>
                </td>
                <td>{entry.email ?? "—"}</td>
                <td>
                  {entry.active_course_names.length
                    ? entry.active_course_names.join(", ")
                    : entry.course_names.join(", ") || "—"}
                </td>
                <td>
                  {entry.active_enrollments > 0
                    ? `${entry.active_enrollments} active`
                    : "No active enrollment"}
                </td>
                <td>
                  {entry.last_access_at
                    ? formatDateTime(entry.last_access_at)
                    : "No recorded activity"}
                </td>
                <td>
                  {entry.progress_percentage === null
                    ? "—"
                    : `${entry.progress_percentage}%`}
                </td>
                <td>{entry.courses_enrolled}</td>
                <td>{entry.courses_completed}</td>
                <td>
                  {entry.latest_completed_at
                    ? formatDateTime(entry.latest_completed_at)
                    : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={11}>
                  No Moodle learners match these filters yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <p>
          Showing {firstRow}–{lastRow} of {total}
        </p>
        <div className="flex gap-3">
          {page > 1 ? (
            <Link
              className="button secondary"
              href={buildRosterHref(params, { page: page - 1 })}
            >
              Previous
            </Link>
          ) : null}
          {hasNext ? (
            <Link
              className="button secondary"
              href={buildRosterHref(params, { page: page + 1 })}
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * Donor-safe view: aggregates only. No names, email addresses, Moodle IDs,
 * sync controls or technical errors, and still behind the admin session.
 */
export function PresentationView({
  metrics,
  params,
}: {
  metrics: ImpactMetricsRow;
  params: RosterParams;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <BrandLogo />
          <div>
            <p className="eyebrow">Digital Regional Cybersecurity Center</p>
            <h1 className="mt-2 text-3xl font-bold">{donorHeadline}</h1>
          </div>
        </div>
        <Link
          className="button secondary"
          href={buildRosterHref(params, { presentation: false })}
        >
          Exit Presentation Mode
        </Link>
      </header>
      <p className="max-w-3xl text-lg leading-8 text-slate-200">
        {donorSummary}
      </p>
      <ImpactCards metrics={metrics} showDefinitions={false} />
      <p className="text-sm text-slate-400">
        Data updated{" "}
        {metrics.lastSuccessfulSyncAt
          ? formatDateTime(metrics.lastSuccessfulSyncAt)
          : "—"}
      </p>
    </main>
  );
}
