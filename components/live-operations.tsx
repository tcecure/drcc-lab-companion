import Link from "next/link";
import {
  ArrowDownAZ,
  ArrowUpZA,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";

import { Card } from "@/components/card";
import { formatDateTime } from "@/lib/format";
import {
  buildLiveOpsHref,
  classifyFreshness,
  connectorLabels,
  freshnessLabels,
  liveOpsPageCount,
  liveOpsPerPageOptions,
  type LiveOpsParams,
} from "@/lib/live-ops";
import {
  activityStatusLabels,
  activityWindowLabels,
  activityWindows,
  eventCountColumn,
} from "@/lib/moodle/activity";
import type {
  ConnectorHealthRow,
  LiveOpsEntry,
  LiveOpsFilterOptions,
  StudentDetail,
} from "@/lib/moodle/live-ops-queries";
import { statusFromEntry } from "@/lib/moodle/live-ops-queries";
import type { TrackedCourseOption } from "@/lib/moodle/queries";

export const liveOpsBasePath = "/admin/community-impact/live";
export const liveOpsRefreshMs = 60_000;

export const activityDataSourceNote =
  "Activity comes from real Moodle log events. Last Seen in Moodle is Moodle's coarse last-access timestamp and is never treated as live activity; a login, an existing session or an open browser tab on its own does not make anyone active.";

function displayName(entry: Pick<LiveOpsEntry, "first_name" | "last_name">) {
  return [entry.last_name, entry.first_name].filter(Boolean).join(", ") || "—";
}

export function LiveOpsSummary({
  activeInWindow,
  inGuacamoleSession,
  learners,
  needsAttention,
  params,
}: {
  activeInWindow: number;
  inGuacamoleSession: number;
  learners: number;
  needsAttention: number;
  params: LiveOpsParams;
}) {
  const windowLabel = activityWindowLabels[params.window];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card eyebrow="Moodle events">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold">
            Active {windowLabel.toLowerCase()}
          </h3>
          <p className="text-3xl font-bold">{activeInWindow}</p>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-300">
          Learners with at least one real Moodle log event inside the selected
          window.
        </p>
      </Card>
      <Card eyebrow="Guacamole">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold">In a lab session</h3>
          <p className="text-3xl font-bold">{inGuacamoleSession}</p>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-300">
          Open Guacamole connections to a pod member server. A lab session is
          not Moodle activity.
        </p>
      </Card>
      <Card eyebrow="Needs attention">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold">Flagged</h3>
          <p className="text-3xl font-bold">{needsAttention}</p>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-300">
          Repeated failed logins, a stale open session, or an assigned student
          with no Moodle events in seven days.
        </p>
      </Card>
      <Card eyebrow="Population">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold">Tracked learners</h3>
          <p className="text-3xl font-bold">{learners}</p>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-300">
          Moodle learners in tracked courses, mapped to portal accounts and pods
          where a match exists.
        </p>
      </Card>
    </div>
  );
}

export function ConnectorHealthPanel({
  connectors,
  now,
}: {
  connectors: ConnectorHealthRow[];
  now?: Date;
}) {
  return (
    <Card eyebrow="Connector health" title="Where this data comes from">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Connector</th>
              <th>State</th>
              <th>Freshness</th>
              <th>Last successful collection</th>
              <th>Last attempt</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((connector) => {
              const freshness = classifyFreshness(
                connector.last_success_at,
                now,
              );

              return (
                <tr key={connector.connector}>
                  <td className="font-bold">
                    {connectorLabels[connector.connector] ??
                      connector.connector}
                  </td>
                  <td>
                    <span className="status-pill">{connector.status}</span>
                  </td>
                  <td>{freshnessLabels[freshness]}</td>
                  <td>
                    {connector.last_success_at
                      ? formatDateTime(connector.last_success_at)
                      : "Never"}
                  </td>
                  <td>
                    {connector.last_attempt_at
                      ? formatDateTime(connector.last_attempt_at)
                      : "Never"}
                  </td>
                  <td className="text-slate-300">
                    {connector.last_error ??
                      (connector.last_success_at
                        ? "No errors reported."
                        : "This connector has not reported yet, so its column reads as unavailable rather than zero.")}
                  </td>
                </tr>
              );
            })}
            {connectors.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  No connector has reported yet. Live Operations shows
                  unavailable rather than implying an idle cohort.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        {activityDataSourceNote}
      </p>
    </Card>
  );
}

export function LiveOpsControls({
  courses,
  options,
  params,
}: {
  courses: TrackedCourseOption[];
  options: LiveOpsFilterOptions;
  params: LiveOpsParams;
}) {
  const oppositeDirection = params.direction === "asc" ? "desc" : "asc";

  return (
    <Card eyebrow="Live Operations" title="Filter operational activity">
      <form action={liveOpsBasePath} className="grid gap-4 md:grid-cols-4">
        <label className="flex flex-col gap-2 text-sm md:col-span-2">
          <span className="font-semibold">Search</span>
          <input
            className="input"
            defaultValue={params.search}
            name="search"
            placeholder="Name, email, lab account, pod or server"
            type="search"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Activity window</span>
          <select className="input" defaultValue={params.window} name="window">
            {activityWindows.map((window) => (
              <option key={window} value={window}>
                {activityWindowLabels[window]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Activity status</span>
          <select
            className="input"
            defaultValue={params.activity}
            name="activity"
          >
            <option value="any">Any activity</option>
            <option value="active_in_window">Active in window</option>
            <option value="idle_in_window">No events in window</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Cohort</span>
          <select
            className="input"
            defaultValue={params.cohort ? String(params.cohort) : ""}
            name="cohort"
          >
            <option value="">All cohorts</option>
            {options.cohorts.map((cohort) => (
              <option key={cohort} value={cohort}>
                Cohort {cohort}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Course</span>
          <select
            className="input"
            defaultValue={params.courseId ? String(params.courseId) : ""}
            name="courseId"
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
          <span className="font-semibold">Pod or server</span>
          <select
            className="input"
            defaultValue={params.pod ?? ""}
            name="pod"
          >
            <option value="">All pods</option>
            {options.pods.map((pod) => (
              <option key={pod} value={pod}>
                {pod}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Lab session</span>
          <select
            className="input"
            defaultValue={params.session}
            name="session"
          >
            <option value="any">Any session state</option>
            <option value="in_session">In a Guacamole session</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Attention</span>
          <select
            className="input"
            defaultValue={params.attention}
            name="attention"
          >
            <option value="any">Everyone</option>
            <option value="needs_attention">Needs attention only</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-semibold">Rows per page</span>
          <select
            className="input"
            defaultValue={String(params.perPage)}
            name="perPage"
          >
            {liveOpsPerPageOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <input name="sort" type="hidden" value={params.sort} />
        <input name="direction" type="hidden" value={params.direction} />
        <div className="flex items-end gap-3 md:col-span-2">
          <button className="button" type="submit">
            Apply
          </button>
          <Link className="button secondary" href={liveOpsBasePath}>
            Reset
          </Link>
        </div>
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          className="button secondary"
          href={buildLiveOpsHref(
            params,
            { direction: oppositeDirection, page: 1, sort: "name" },
            liveOpsBasePath,
          )}
        >
          {params.direction === "asc" ? (
            <ArrowUpZA aria-hidden="true" size={17} />
          ) : (
            <ArrowDownAZ aria-hidden="true" size={17} />
          )}
          Sort last name {params.direction === "asc" ? "Z–A" : "A–Z"}
        </Link>
        <Link
          className="button secondary"
          href={buildLiveOpsHref(
            params,
            { direction: "desc", page: 1, sort: "activity" },
            liveOpsBasePath,
          )}
        >
          Sort by most recent activity
        </Link>
        <Link
          aria-label="Refresh Live Operations"
          className="button secondary ml-auto"
          href={buildLiveOpsHref(params, {}, liveOpsBasePath)}
          prefetch={false}
        >
          <RefreshCw aria-hidden="true" size={17} />
          Refresh now
        </Link>
      </div>
      <p className="mt-4 text-sm text-slate-400">
        This view refreshes itself every 60 seconds. It is read-only: there is no
        control here that can suspend an account or disconnect a session.
      </p>
    </Card>
  );
}

export function LiveOpsTable({
  entries,
  params,
  total,
}: {
  entries: LiveOpsEntry[];
  params: LiveOpsParams;
  total: number;
}) {
  const countColumn = eventCountColumn(params.window);
  const firstRow = total === 0 ? 0 : (params.page - 1) * params.perPage + 1;
  const lastRow = Math.min(params.page * params.perPage, total);
  const pageCount = liveOpsPageCount(total, params.perPage);

  return (
    <Card
      eyebrow="Student to portal to Moodle to lab"
      title={`${total} learner${total === 1 ? "" : "s"}`}
    >
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Portal</th>
              <th>Cohort and pod</th>
              <th>Session host</th>
              <th>Activity status</th>
              <th>Events in {activityWindowLabels[params.window]}</th>
              <th>Last Moodle event</th>
              <th>Last Seen in Moodle</th>
              <th>Lab session</th>
              <th>Progress</th>
              <th>Flags</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.moodle_user_id}>
                <td className="font-bold">{displayName(entry)}</td>
                <td>
                  <span className="status-pill">{entry.match_status}</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {entry.email ?? "No Moodle email"}
                  </span>
                </td>
                <td>
                  {entry.cohort_number
                    ? `Cohort ${entry.cohort_number}${entry.pod_name ? ` · ${entry.pod_name}` : ""}`
                    : "Unassigned"}
                </td>
                <td>{entry.session_host ?? "—"}</td>
                <td>{activityStatusLabels[statusFromEntry(entry)]}</td>
                <td>{Number(entry[countColumn] ?? 0)}</td>
                <td>
                  {entry.last_event_at
                    ? formatDateTime(entry.last_event_at)
                    : "No events collected"}
                </td>
                <td>
                  {entry.last_seen_in_moodle_at
                    ? formatDateTime(entry.last_seen_in_moodle_at)
                    : "—"}
                </td>
                <td>
                  {entry.guac_open_sessions > 0
                    ? `${entry.guac_open_sessions} open${entry.guac_open_connection_names.length ? ` · ${entry.guac_open_connection_names.join(", ")}` : ""}`
                    : "None open"}
                </td>
                <td>
                  {entry.progress_percentage === null
                    ? "—"
                    : `${entry.progress_percentage}%`}
                </td>
                <td>
                  {entry.needs_attention ? (
                    <span className="inline-flex items-center gap-2 text-amber-200">
                      <ShieldAlert aria-hidden="true" size={16} />
                      Attention
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <Link
                    className="button secondary"
                    href={buildLiveOpsHref(
                      params,
                      {},
                      `${liveOpsBasePath}/${entry.moodle_user_id}`,
                    )}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={12}>
                  No learner matches these filters. If every column reads
                  unavailable, check connector health above before assuming the
                  cohort is idle.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <p>
          Showing {firstRow}–{lastRow} of {total} (page {params.page} of{" "}
          {pageCount})
        </p>
        <div className="flex gap-3">
          {params.page > 1 ? (
            <Link
              className="button secondary"
              href={buildLiveOpsHref(
                params,
                { page: params.page - 1 },
                liveOpsBasePath,
              )}
            >
              Previous
            </Link>
          ) : null}
          {params.page < pageCount ? (
            <Link
              className="button secondary"
              href={buildLiveOpsHref(
                params,
                { page: params.page + 1 },
                liveOpsBasePath,
              )}
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
 * Admin-only student drawer. Read-only by design: recent real events, course
 * progress, lab assignment, Guacamole sessions, access dates, IP history and
 * security flags, with no action that can change Moodle or the lab.
 */
export function StudentDetailDrawer({
  detail,
  params,
}: {
  detail: StudentDetail;
  params: LiveOpsParams;
}) {
  const { entry } = detail;
  const closeHref = buildLiveOpsHref(params, {}, liveOpsBasePath);

  if (!entry) {
    return (
      <Card eyebrow="Student detail" title="Learner not found">
        <p className="text-sm leading-6 text-slate-300">
          This learner is no longer in the Live Operations projection. They may
          have been removed from every tracked course.
        </p>
        <Link className="button secondary mt-4" href={closeHref}>
          Back to Live Operations
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        eyebrow="Student detail"
        title={`${entry.first_name} ${entry.last_name}`.trim() || "Learner"}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid flex-1 gap-4 text-sm leading-6 sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Moodle account</dt>
              <dd className="text-slate-300">
                {entry.moodle_username ?? "—"} (id {entry.moodle_user_id})
                <br />
                {entry.email ?? "No Moodle email"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Portal account</dt>
              <dd className="text-slate-300">
                {entry.match_status}
                {entry.profile_id ? "" : " · no portal profile matched"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Lab assignment</dt>
              <dd className="text-slate-300">
                {entry.cohort_number
                  ? `Cohort ${entry.cohort_number}, seat ${entry.seat_number ?? "—"}, ${entry.pod_name ?? "no pod"}`
                  : "No cohort assignment"}
                <br />
                {entry.session_host
                  ? `Session host ${entry.session_host}`
                  : "No session host recorded"}
                {entry.lab_username ? ` · lab account ${entry.lab_username}` : ""}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Access window</dt>
              <dd className="text-slate-300">
                {entry.access_starts_at
                  ? formatDateTime(entry.access_starts_at)
                  : "—"}{" "}
                to{" "}
                {entry.access_ends_at
                  ? formatDateTime(entry.access_ends_at)
                  : "—"}
                {entry.assignment_status
                  ? ` · ${entry.assignment_status}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Activity status</dt>
              <dd className="text-slate-300">
                {activityStatusLabels[statusFromEntry(entry)]}
                <br />
                {entry.last_event_at
                  ? `Last real Moodle event ${formatDateTime(entry.last_event_at)}${entry.last_event_name ? ` (${entry.last_event_name})` : ""}`
                  : "No Moodle events collected"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Last Seen in Moodle</dt>
              <dd className="text-slate-300">
                {entry.last_seen_in_moodle_at
                  ? formatDateTime(entry.last_seen_in_moodle_at)
                  : "—"}{" "}
                — Moodle&apos;s coarse last-access value, not real-time activity.
              </dd>
            </div>
          </dl>
          <Link
            aria-label="Close student detail"
            className="button secondary"
            href={closeHref}
          >
            <X aria-hidden="true" size={17} />
            Close
          </Link>
        </div>
      </Card>

      <Card eyebrow="Moodle" title="Recent Moodle events">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Course</th>
                <th>Origin</th>
                <th>Source address</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((event) => (
                <tr key={`${event.occurredAt}-${event.eventName}`}>
                  <td>{formatDateTime(event.occurredAt)}</td>
                  <td>{event.eventName}</td>
                  <td>{event.courseName ?? event.courseId ?? "—"}</td>
                  <td>{event.origin || "—"}</td>
                  <td>{event.sourceIp ?? "—"}</td>
                </tr>
              ))}
              {detail.events.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    No collected Moodle events for this learner.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Moodle" title="Course progress">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Completion</th>
                <th>Progress</th>
                <th>Completed</th>
                <th>Last Seen in Moodle</th>
              </tr>
            </thead>
            <tbody>
              {detail.courses.map((course) => (
                <tr key={course.moodleCourseId}>
                  <td className="font-bold">{course.courseName}</td>
                  <td>{course.completionState}</td>
                  <td>
                    {course.progressPercentage === null
                      ? "—"
                      : `${course.progressPercentage}%`}
                  </td>
                  <td>
                    {course.completedAt
                      ? formatDateTime(course.completedAt)
                      : "—"}
                  </td>
                  <td>
                    {course.lastAccessAt
                      ? formatDateTime(course.lastAccessAt)
                      : "—"}
                  </td>
                </tr>
              ))}
              {detail.courses.length === 0 ? (
                <tr>
                  <td colSpan={5}>No tracked enrollments.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Guacamole" title="Lab sessions">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Ended</th>
                <th>Connection</th>
                <th>Remote host</th>
              </tr>
            </thead>
            <tbody>
              {detail.guacamoleSessions.map((session) => (
                <tr key={`${session.startedAt}-${session.connectionName}`}>
                  <td>{formatDateTime(session.startedAt)}</td>
                  <td>
                    {session.endedAt ? formatDateTime(session.endedAt) : "Open"}
                  </td>
                  <td>{session.connectionName || "—"}</td>
                  <td>{session.remoteHost ?? "—"}</td>
                </tr>
              ))}
              {detail.guacamoleSessions.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    {entry.lab_username
                      ? "No Guacamole sessions collected for this lab account."
                      : "No lab account is mapped to this learner, so Guacamole sessions cannot be attributed."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Security" title="Address history and flags">
        <dl className="grid gap-4 text-sm leading-6 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Failed logins in seven days</dt>
            <dd className="text-slate-300">
              {entry.failed_logins_7d}
              {entry.last_failed_login_at
                ? ` · most recent ${formatDateTime(entry.last_failed_login_at)}`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Distinct addresses in seven days</dt>
            <dd className="text-slate-300">{entry.distinct_ips_7d}</dd>
          </div>
        </dl>
        <div className="table-wrap mt-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source address</th>
                <th>Events</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {detail.ipHistory.map((observation) => (
                <tr key={observation.sourceIp}>
                  <td className="font-bold">{observation.sourceIp}</td>
                  <td>{observation.events}</td>
                  <td>{formatDateTime(observation.firstSeenAt)}</td>
                  <td>{formatDateTime(observation.lastSeenAt)}</td>
                </tr>
              ))}
              {detail.ipHistory.length === 0 ? (
                <tr>
                  <td colSpan={4}>No addresses recorded.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="table-wrap mt-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Failed login</th>
                <th>Attempted username</th>
                <th>Reason</th>
                <th>Source address</th>
              </tr>
            </thead>
            <tbody>
              {detail.loginFailures.map((failure) => (
                <tr key={`${failure.occurredAt}-${failure.attemptedUsername}`}>
                  <td>{formatDateTime(failure.occurredAt)}</td>
                  <td>{failure.attemptedUsername || "—"}</td>
                  <td>{failure.reason || "—"}</td>
                  <td>{failure.sourceIp ?? "—"}</td>
                </tr>
              ))}
              {detail.loginFailures.length === 0 ? (
                <tr>
                  <td colSpan={4}>No failed logins collected.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
