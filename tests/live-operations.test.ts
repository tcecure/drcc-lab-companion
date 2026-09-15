import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildLiveOpsHref,
  classifyFreshness,
  defaultLiveOpsParams,
  liveOpsPageCount,
  liveOpsRange,
  parseLiveOpsParams,
} from "@/lib/live-ops";
import {
  activityEventFromMoodle,
  activityStatusLabels,
  classifyActivity,
  eventCountColumn,
  isLearnerActivity,
  loginFailureFromMoodle,
  parseActivityWindow,
  statusesWithinWindow,
} from "@/lib/moodle/activity";
import {
  isLiveSession,
  parseGuacamoleIngest,
} from "@/lib/guacamole/sessions";

const now = new Date("2026-09-15T12:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

describe("activity window calculations", () => {
  it("classifies real event timestamps into the agreed windows", () => {
    expect(classifyActivity(minutesAgo(1), now)).toBe("active_now");
    expect(classifyActivity(minutesAgo(15), now)).toBe("active_now");
    expect(classifyActivity(minutesAgo(16), now)).toBe("active_2h");
    expect(classifyActivity(minutesAgo(120), now)).toBe("active_2h");
    expect(classifyActivity(minutesAgo(121), now)).toBe("active_24h");
    expect(classifyActivity(minutesAgo(24 * 60), now)).toBe("active_24h");
    expect(classifyActivity(minutesAgo(24 * 60 + 1), now)).toBe("active_7d");
    expect(classifyActivity(minutesAgo(7 * 24 * 60), now)).toBe("active_7d");
    expect(classifyActivity(minutesAgo(7 * 24 * 60 + 1), now)).toBe(
      "no_recent_activity",
    );
  });

  it("treats a missing or unreadable timestamp as no activity", () => {
    expect(classifyActivity(null, now)).toBe("no_recent_activity");
    expect(classifyActivity(undefined, now)).toBe("no_recent_activity");
    expect(classifyActivity("not a date", now)).toBe("no_recent_activity");
  });

  it("never labels last access or a session as active", () => {
    expect(activityStatusLabels.active_now).toBe("Active now");
    expect(activityStatusLabels.no_recent_activity).not.toContain("Active");
    expect(Object.values(activityStatusLabels).join(" ")).not.toMatch(
      /last login|open tab|session/i,
    );
  });

  it("maps a window to its statuses and its count column", () => {
    expect(statusesWithinWindow("15m")).toEqual(["active_now"]);
    expect(statusesWithinWindow("2h")).toEqual(["active_now", "active_2h"]);
    expect(statusesWithinWindow("7d")).toHaveLength(4);
    expect(eventCountColumn("15m")).toBe("events_15m");
    expect(eventCountColumn("24h")).toBe("events_24h");
    expect(parseActivityWindow("24h")).toBe("24h");
    expect(parseActivityWindow("nonsense")).toBe("2h");
  });
});

describe("moodle activity payloads", () => {
  it("shapes a real log row and keeps the address for admin use", () => {
    const event = activityEventFromMoodle({
      id: 206930,
      eventname: "\\core\\event\\course_viewed",
      component: "core",
      action: "viewed",
      target: "course",
      courseid: 11,
      userid: 207,
      origin: "web",
      ip: "192.168.1.55",
      timecreated: 1789427252,
    });

    expect(event).not.toBeNull();
    expect(event?.moodleLogId).toBe(206930);
    expect(event?.moodleUserId).toBe(207);
    expect(event?.courseId).toBe(11);
    expect(event?.sourceIp).toBe("192.168.1.55");
    expect(event?.occurredAt).toBe(new Date(1789427252 * 1000).toISOString());
    expect(isLearnerActivity(event!)).toBe(true);
  });

  it("rejects rows that are not learner activity", () => {
    const webservice = activityEventFromMoodle({
      id: 1,
      eventname: "\\core\\event\\webservice_function_called",
      userid: 253,
      origin: "ws",
      timecreated: 1789427252,
    });
    expect(isLearnerActivity(webservice!)).toBe(false);

    const cli = activityEventFromMoodle({
      id: 2,
      eventname: "\\core\\event\\course_viewed",
      userid: 3,
      origin: "cli",
      timecreated: 1789427252,
    });
    expect(isLearnerActivity(cli!)).toBe(false);

    expect(activityEventFromMoodle({ id: 0, userid: 0 })).toBeNull();
    expect(activityEventFromMoodle("nope")).toBeNull();
  });

  it("shapes a failed login, including an unknown account", () => {
    const failure = loginFailureFromMoodle({
      id: 900,
      userid: 0,
      username: "administrator",
      reason: 3,
      ip: "10.1.2.3",
      timecreated: 1789427000,
    });

    expect(failure?.moodleLogId).toBe(900);
    expect(failure?.moodleUserId).toBeNull();
    expect(failure?.attemptedUsername).toBe("administrator");
    expect(failure?.sourceIp).toBe("10.1.2.3");
  });
});

describe("live operations query parameters", () => {
  it("falls back to safe defaults for junk input", () => {
    const params = parseLiveOpsParams({
      activity: "everything",
      attention: "maybe",
      cohort: "-4",
      courseId: "abc",
      direction: "sideways",
      page: "0",
      perPage: "999",
      window: "3y",
    });

    expect(params).toEqual(defaultLiveOpsParams);
  });

  it("keeps the filters it recognises", () => {
    const params = parseLiveOpsParams({
      activity: "active_in_window",
      attention: "needs_attention",
      cohort: "2",
      courseId: "17",
      direction: "desc",
      page: "3",
      perPage: "50",
      pod: "Pod04",
      search: "  Wallace  ",
      session: "in_session",
      sort: "activity",
      window: "15m",
    });

    expect(params.activity).toBe("active_in_window");
    expect(params.attention).toBe("needs_attention");
    expect(params.cohort).toBe(2);
    expect(params.courseId).toBe(17);
    expect(params.pod).toBe("Pod04");
    expect(params.search).toBe("Wallace");
    expect(params.session).toBe("in_session");
    expect(params.sort).toBe("activity");
    expect(params.window).toBe("15m");
    expect(params.direction).toBe("desc");
  });

  it("paginates and builds a round-trippable address", () => {
    const params = parseLiveOpsParams({ page: "3", perPage: "50" });
    expect(liveOpsRange(params)).toEqual({ from: 100, to: 149 });
    expect(liveOpsPageCount(101, 50)).toBe(3);
    expect(liveOpsPageCount(0, 25)).toBe(1);

    const href = buildLiveOpsHref(params, { pod: "Pod07", window: "24h" });
    expect(href).toContain("/admin/community-impact/live?");
    expect(href).toContain("pod=Pod07");
    expect(href).toContain("window=24h");
    expect(buildLiveOpsHref(defaultLiveOpsParams)).toBe(
      "/admin/community-impact/live",
    );
    expect(parseLiveOpsParams({ pod: "Pod07", window: "24h" }).pod).toBe(
      "Pod07",
    );
  });
});

describe("connector freshness and stale data", () => {
  it("reports unavailable rather than implying an idle cohort", () => {
    expect(classifyFreshness(null, now)).toBe("unavailable");
    expect(classifyFreshness("not a date", now)).toBe("unavailable");
  });

  it("degrades from current to delayed to stale", () => {
    expect(classifyFreshness(minutesAgo(2), now)).toBe("current");
    expect(classifyFreshness(minutesAgo(10), now)).toBe("current");
    expect(classifyFreshness(minutesAgo(11), now)).toBe("delayed");
    expect(classifyFreshness(minutesAgo(60), now)).toBe("delayed");
    expect(classifyFreshness(minutesAgo(61), now)).toBe("stale");
  });
});

describe("guacamole session ingest", () => {
  it("accepts collector rows and ignores unusable ones", () => {
    const parsed = parseGuacamoleIngest({
      collectedAt: "2026-09-15T12:00:00.000Z",
      webReachable: true,
      sessions: [
        {
          historyId: 5501,
          username: "student04",
          userId: 12,
          connectionName: "POD04-SRV",
          remoteHost: "73.20.1.9",
          startedAt: "2026-09-15T11:40:00.000Z",
          endedAt: null,
        },
        { historyId: 0, username: "", startedAt: "" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.payload.sessions).toHaveLength(1);
    expect(parsed.payload.sessions[0].connectionName).toBe("POD04-SRV");
    expect(parsed.payload.webReachable).toBe(true);
  });

  it("rejects a body that is not a session payload", () => {
    expect(parseGuacamoleIngest(null).ok).toBe(false);
    expect(parseGuacamoleIngest({ sessions: "many" }).ok).toBe(false);
  });

  it("treats an old open row as stale instead of live", () => {
    expect(
      isLiveSession({ endedAt: null, startedAt: minutesAgo(30) }, now),
    ).toBe(true);
    expect(
      isLiveSession({ endedAt: null, startedAt: minutesAgo(60 * 25) }, now),
    ).toBe(false);
    expect(
      isLiveSession(
        { endedAt: minutesAgo(5), startedAt: minutesAgo(30) },
        now,
      ),
    ).toBe(false);
  });
});

describe("live operations authorization and read-only posture", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("requires an administrator on both Live Operations pages", () => {
    const list = read("app/admin/community-impact/live/page.tsx");
    const detail = read("app/admin/community-impact/live/[moodleUserId]/page.tsx");

    expect(list).toContain("requireAdmin()");
    expect(detail).toContain("requireAdmin()");
  });

  it("ships no destructive control in the first release", () => {
    const component = read("components/live-operations.tsx");

    // No mutation path at all: no server action, no POST, no write client.
    expect(component).not.toContain("use server");
    expect(component).not.toContain("method=\"post\"");
    expect(component).not.toMatch(/method:\s*"POST"/);
    expect(component).not.toContain("useActionState");
    // The copy says plainly that the release cannot act on an account.
    expect(component).toContain("suspend an account");
  });

  it("keeps every external credential server-side", () => {
    const activity = read("lib/moodle/activity-sync.ts");
    const ingest = read("lib/guacamole/ingest.ts");
    const queries = read("lib/moodle/live-ops-queries.ts");

    for (const source of [activity, ingest, queries]) {
      expect(source.startsWith('import "server-only";')).toBe(true);
      expect(source).not.toContain("NEXT_PUBLIC_MOODLE");
    }
  });
});
