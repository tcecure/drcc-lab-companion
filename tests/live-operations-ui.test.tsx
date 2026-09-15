import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConnectorHealthPanel,
  LiveOpsControls,
  LiveOpsSummary,
  LiveOpsTable,
  StudentDetailDrawer,
} from "@/components/live-operations";
import { PresentationView } from "@/components/community-impact";
import { parseLiveOpsParams } from "@/lib/live-ops";
import { emptyImpactMetrics, parseRosterParams } from "@/lib/moodle/impact";
import type {
  ConnectorHealthRow,
  LiveOpsEntry,
  StudentDetail,
} from "@/lib/moodle/live-ops-queries";

const params = parseLiveOpsParams({});

const entry: LiveOpsEntry = {
  access_ends_at: "2026-09-20T23:59:00.000Z",
  access_starts_at: "2026-09-06T00:00:00.000Z",
  activity_status: "active_now",
  active_enrollments: 2,
  assignment_status: "active",
  cohort_number: 2,
  course_ids: [17],
  course_names: ["IA Module 3"],
  courses_completed: 1,
  courses_enrolled: 2,
  distinct_ips_7d: 2,
  email: "erik.wallace@example.com",
  events_15m: 4,
  events_24h: 40,
  events_2h: 11,
  events_7d: 120,
  failed_logins_7d: 4,
  first_name: "Erik",
  first_name_sort: "erik",
  guac_last_connection_name: "POD11-SRV",
  guac_last_remote_host: "73.20.1.9",
  guac_last_session_started_at: "2026-09-15T11:00:00.000Z",
  guac_open_connection_names: ["POD11-SRV"],
  guac_open_sessions: 1,
  guac_stale_open_sessions: 0,
  lab_username: "student11",
  last_event_at: "2026-09-15T11:58:00.000Z",
  last_event_name: "\\mod_scorm\\event\\sco_launched",
  last_failed_login_at: "2026-09-15T09:00:00.000Z",
  last_name: "Wallace",
  last_name_sort: "wallace",
  last_seen_in_moodle_at: "2026-09-15T11:50:00.000Z",
  last_source_ip: "73.20.1.9",
  match_status: "matched",
  moodle_user_id: 207,
  moodle_username: "ewallace",
  needs_attention: true,
  pod_name: "Pod11",
  profile_id: "profile-11",
  progress_percentage: 62.5,
  seat_number: 11,
  session_host: "POD11-SRV",
};

const connectors: ConnectorHealthRow[] = [
  {
    connector: "moodle_activity",
    cursor_value: 206930,
    detail: {},
    last_attempt_at: "2026-09-15T11:59:00.000Z",
    last_error: null,
    last_success_at: "2026-09-15T11:59:00.000Z",
    status: "ok",
    updated_at: "2026-09-15T11:59:00.000Z",
  },
  {
    connector: "guacamole_sessions",
    cursor_value: 0,
    detail: {},
    last_attempt_at: "2026-09-15T11:00:00.000Z",
    last_error: "Collector could not reach the Guacamole database.",
    last_success_at: null,
    status: "failed",
    updated_at: "2026-09-15T11:00:00.000Z",
  },
];

describe("live operations rendering", () => {
  it("shows the mapping, real activity and Last Seen in Moodle separately", () => {
    const html = renderToStaticMarkup(
      <LiveOpsTable entries={[entry]} params={params} total={1} />,
    );

    expect(html).toContain("Wallace, Erik");
    expect(html).toContain("Cohort 2");
    expect(html).toContain("POD11-SRV");
    expect(html).toContain("Active now");
    expect(html).toContain("Last Seen in Moodle");
    expect(html).toContain("Attention");
    expect(html).toContain("Events in Last 2 hours");
  });

  it("uses a horizontally scrollable table and a responsive card grid", () => {
    const table = renderToStaticMarkup(
      <LiveOpsTable entries={[entry]} params={params} total={1} />,
    );
    expect(table).toContain("table-wrap");

    const summary = renderToStaticMarkup(
      <LiveOpsSummary
        activeInWindow={3}
        inGuacamoleSession={1}
        learners={228}
        needsAttention={2}
        params={params}
      />,
    );
    expect(summary).toContain("sm:grid-cols-2");
    expect(summary).toContain("xl:grid-cols-4");

    const controls = renderToStaticMarkup(
      <LiveOpsControls
        courses={[]}
        options={{ cohorts: [], pods: [] }}
        params={params}
      />,
    );
    expect(controls).toContain("md:grid-cols-4");
  });

  it("names a stale open session in the table instead of dropping it", () => {
    const html = renderToStaticMarkup(
      <LiveOpsTable
        entries={[
          {
            ...entry,
            guac_open_connection_names: [],
            guac_open_sessions: 0,
            guac_stale_open_sessions: 1,
          },
        ]}
        params={params}
        total={1}
      />,
    );

    expect(html).toContain("None live");
    expect(html).toContain("1 stale");
    expect(html).not.toContain("None open");
  });

  it("labels a stale open session on the detail page as not live", () => {
    const html = renderToStaticMarkup(
      <StudentDetailDrawer
        detail={{
          courses: [],
          entry: {
            ...entry,
            guac_open_sessions: 0,
            guac_stale_open_sessions: 1,
          },
          events: [],
          guacamoleSessions: [
            {
              connectionName: "POD11-SRV",
              endedAt: null,
              remoteHost: "73.20.1.9",
              startedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          ipHistory: [],
          loginFailures: [],
        }}
        params={params}
      />,
    );

    expect(html).toContain("stale, not a live session");
  });

  it("explains an empty table instead of implying an idle cohort", () => {
    const html = renderToStaticMarkup(
      <LiveOpsTable entries={[]} params={params} total={0} />,
    );

    expect(html).toContain("No learner matches these filters");
    expect(html).toContain("connector health");
    expect(html).toContain("Showing 0–0 of 0");
  });

  it("surfaces a failing connector and a connector that never reported", () => {
    const html = renderToStaticMarkup(
      <ConnectorHealthPanel
        connectors={connectors}
        now={new Date("2026-09-15T12:00:00.000Z")}
      />,
    );

    expect(html).toContain("Moodle activity events");
    expect(html).toContain("Up to date");
    expect(html).toContain("No successful collection");
    expect(html).toContain("could not reach the Guacamole database");
    expect(html).toContain("never treated as live activity");
  });

  it("reports stale data when the last success is old", () => {
    const html = renderToStaticMarkup(
      <ConnectorHealthPanel
        connectors={connectors}
        now={new Date("2026-09-16T12:00:00.000Z")}
      />,
    );

    expect(html).toContain("Stale");
  });

  it("says so when no connector has reported at all", () => {
    const html = renderToStaticMarkup(<ConnectorHealthPanel connectors={[]} />);

    expect(html).toContain("No connector has reported yet");
  });

  it("offers every required filter and no destructive control", () => {
    const html = renderToStaticMarkup(
      <LiveOpsControls
        courses={[{ fullName: "IA Module 3", moodleCourseId: 17 }]}
        options={{ cohorts: [2, 1], pods: ["Pod01", "Pod11"] }}
        params={params}
      />,
    );

    expect(html).toContain("Activity window");
    expect(html).toContain("Last 15 minutes");
    expect(html).toContain("Last 7 days");
    expect(html).toContain("Activity status");
    expect(html).toContain("All cohorts");
    expect(html).toContain("All tracked courses");
    expect(html).toContain("All pods");
    expect(html).toContain("Needs attention only");
    expect(html).toContain("In a Guacamole session");
    expect(html).toContain("Sort last name");
    expect(html).toContain("Refresh now");
    expect(html).toContain("read-only");
    expect(html).not.toContain('<button type="submit" name=');
  });
});

describe("student detail drawer", () => {
  const detail: StudentDetail = {
    courses: [
      {
        completedAt: null,
        completionState: "incomplete",
        courseName: "IA Module 3",
        lastAccessAt: "2026-09-15T11:50:00.000Z",
        moodleCourseId: 17,
        progressPercentage: 62.5,
      },
    ],
    entry,
    events: [
      {
        action: "launched",
        courseId: 17,
        courseName: "IA Module 3",
        eventName: "\\mod_scorm\\event\\sco_launched",
        occurredAt: "2026-09-15T11:58:00.000Z",
        origin: "web",
        sourceIp: "73.20.1.9",
      },
    ],
    guacamoleSessions: [
      {
        connectionName: "POD11-SRV",
        endedAt: null,
        remoteHost: "73.20.1.9",
        startedAt: "2026-09-15T11:00:00.000Z",
      },
    ],
    ipHistory: [
      {
        events: 12,
        firstSeenAt: "2026-09-14T10:00:00.000Z",
        lastSeenAt: "2026-09-15T11:58:00.000Z",
        sourceIp: "73.20.1.9",
      },
    ],
    loginFailures: [
      {
        attemptedUsername: "ewallace",
        occurredAt: "2026-09-15T09:00:00.000Z",
        reason: "3",
        sourceIp: "73.20.1.9",
      },
    ],
  };

  it("shows events, progress, lab assignment, sessions, dates, addresses and flags", () => {
    const html = renderToStaticMarkup(
      <StudentDetailDrawer detail={detail} params={params} />,
    );

    expect(html).toContain("Recent Moodle events");
    expect(html).toContain("sco_launched");
    expect(html).toContain("Course progress");
    expect(html).toContain("Lab assignment");
    expect(html).toContain("POD11-SRV");
    expect(html).toContain("Lab sessions");
    expect(html).toContain("Access window");
    expect(html).toContain("Address history and flags");
    expect(html).toContain("73.20.1.9");
    expect(html).toContain("Failed logins in seven days");
    expect(html).toContain("not real-time activity");
  });

  it("explains empty sections and a missing learner", () => {
    const empty = renderToStaticMarkup(
      <StudentDetailDrawer
        detail={{
          courses: [],
          entry: { ...entry, lab_username: null },
          events: [],
          guacamoleSessions: [],
          ipHistory: [],
          loginFailures: [],
        }}
        params={params}
      />,
    );

    expect(empty).toContain("No collected Moodle events");
    expect(empty).toContain("No tracked enrollments");
    expect(empty).toContain("No lab account is mapped");
    expect(empty).toContain("No addresses recorded");
    expect(empty).toContain("No failed logins collected");

    const missing = renderToStaticMarkup(
      <StudentDetailDrawer
        detail={{
          courses: [],
          entry: null,
          events: [],
          guacamoleSessions: [],
          ipHistory: [],
          loginFailures: [],
        }}
        params={params}
      />,
    );

    expect(missing).toContain("Learner not found");
  });
});

describe("donor-facing impact stays free of operational detail", () => {
  it("shows no name, address, event or session information", () => {
    const html = renderToStaticMarkup(
      <PresentationView
        metrics={emptyImpactMetrics}
        params={parseRosterParams({})}
      />,
    );

    for (const secret of [
      "Wallace",
      "erik.wallace@example.com",
      "73.20.1.9",
      "POD11-SRV",
      "sco_launched",
      "student11",
    ]) {
      expect(html).not.toContain(secret);
    }

    expect(html).not.toMatch(/active now|failed login|guacamole/i);
  });
});
