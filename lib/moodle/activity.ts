/**
 * Pure translation of the local_drccops read functions into the portal's
 * activity projection, plus the activity window vocabulary shared by the
 * server queries and the Live Operations interface.
 *
 * Nothing here talks to Moodle or Supabase.
 */

export type ActivityWindow = "15m" | "2h" | "24h" | "7d";

export type ActivityStatus =
  | "active_now"
  | "active_2h"
  | "active_24h"
  | "active_7d"
  | "no_recent_activity";

export type MoodleActivityEvent = {
  action: string;
  component: string;
  courseId: number | null;
  eventName: string;
  moodleLogId: number;
  moodleUserId: number;
  occurredAt: string;
  origin: string;
  sourceIp: string | null;
  target: string;
};

export type MoodleLoginFailure = {
  attemptedUsername: string;
  moodleLogId: number;
  moodleUserId: number | null;
  occurredAt: string;
  reason: string;
  sourceIp: string | null;
};

export const activityWindows: ActivityWindow[] = ["15m", "2h", "24h", "7d"];

export const activityWindowMinutes: Record<ActivityWindow, number> = {
  "15m": 15,
  "2h": 120,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
};

export const activityWindowLabels: Record<ActivityWindow, string> = {
  "15m": "Last 15 minutes",
  "2h": "Last 2 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

/**
 * Deliberate wording. Only a real Moodle log event earns an "active" label; a
 * login, an existing session or an open browser tab does not.
 */
export const activityStatusLabels: Record<ActivityStatus, string> = {
  active_now: "Active now",
  active_2h: "Active within 2 hours",
  active_24h: "Active within 24 hours",
  active_7d: "Active within 7 days",
  no_recent_activity: "No Moodle activity in 7 days",
};

export const activityStatusDescriptions: Record<ActivityStatus, string> = {
  active_now: "A Moodle activity event was recorded in the last 15 minutes.",
  active_2h: "A Moodle activity event was recorded in the last 2 hours.",
  active_24h: "A Moodle activity event was recorded in the last 24 hours.",
  active_7d: "A Moodle activity event was recorded in the last 7 days.",
  no_recent_activity:
    "No Moodle activity event in the last 7 days. Last Seen in Moodle is a coarse access timestamp, not activity.",
};

export function isActivityWindow(value: unknown): value is ActivityWindow {
  return (
    typeof value === "string" &&
    (activityWindows as string[]).includes(value)
  );
}

export function parseActivityWindow(value: unknown): ActivityWindow {
  return isActivityWindow(value) ? value : "2h";
}

/**
 * Classifies a learner from the timestamp of their most recent real Moodle
 * event. A missing timestamp is never "active".
 */
export function classifyActivity(
  lastEventAt: Date | string | null | undefined,
  now: Date = new Date(),
): ActivityStatus {
  if (!lastEventAt) {
    return "no_recent_activity";
  }

  const occurred =
    lastEventAt instanceof Date ? lastEventAt : new Date(lastEventAt);

  if (Number.isNaN(occurred.getTime())) {
    return "no_recent_activity";
  }

  const minutes = (now.getTime() - occurred.getTime()) / 60_000;

  if (minutes < 0) {
    return "active_now";
  }
  if (minutes <= activityWindowMinutes["15m"]) {
    return "active_now";
  }
  if (minutes <= activityWindowMinutes["2h"]) {
    return "active_2h";
  }
  if (minutes <= activityWindowMinutes["24h"]) {
    return "active_24h";
  }
  if (minutes <= activityWindowMinutes["7d"]) {
    return "active_7d";
  }

  return "no_recent_activity";
}

/** Statuses that count as activity inside the selected window. */
export function statusesWithinWindow(window: ActivityWindow): ActivityStatus[] {
  const ordered: ActivityStatus[] = [
    "active_now",
    "active_2h",
    "active_24h",
    "active_7d",
  ];
  const limits: Record<ActivityWindow, number> = {
    "15m": 1,
    "2h": 2,
    "24h": 3,
    "7d": 4,
  };

  return ordered.slice(0, limits[window]);
}

/** Column on the Live Operations view holding the event count for a window. */
export function eventCountColumn(window: ActivityWindow) {
  const columns: Record<
    ActivityWindow,
    "events_15m" | "events_2h" | "events_24h" | "events_7d"
  > = {
    "15m": "events_15m",
    "2h": "events_2h",
    "24h": "events_24h",
    "7d": "events_7d",
  };

  return columns[window];
}

function readNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return 0;
}

function readText(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function readIp(source: Record<string, unknown>, key: string) {
  const value = readText(source, key).trim();
  return value || null;
}

function isoFromSeconds(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

export function activityEventFromMoodle(
  payload: unknown,
): MoodleActivityEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const moodleLogId = readNumber(source, "id");
  const moodleUserId = readNumber(source, "userid");
  const timecreated = readNumber(source, "timecreated");

  if (moodleLogId <= 0 || moodleUserId <= 0 || timecreated <= 0) {
    return null;
  }

  const courseId = readNumber(source, "courseid");

  return {
    action: readText(source, "action"),
    component: readText(source, "component"),
    courseId: courseId > 0 ? courseId : null,
    eventName: readText(source, "eventname"),
    moodleLogId,
    moodleUserId,
    occurredAt: isoFromSeconds(timecreated),
    origin: readText(source, "origin"),
    sourceIp: readIp(source, "ip"),
    target: readText(source, "target"),
  };
}

export function loginFailureFromMoodle(
  payload: unknown,
): MoodleLoginFailure | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const moodleLogId = readNumber(source, "id");
  const timecreated = readNumber(source, "timecreated");

  if (moodleLogId <= 0 || timecreated <= 0) {
    return null;
  }

  const moodleUserId = readNumber(source, "userid");

  return {
    attemptedUsername: readText(source, "username").trim(),
    moodleLogId,
    moodleUserId: moodleUserId > 0 ? moodleUserId : null,
    occurredAt: isoFromSeconds(timecreated),
    reason: readText(source, "reason"),
    sourceIp: readIp(source, "ip"),
  };
}

/**
 * Web service traffic is this integration polling Moodle, and background cron
 * events are not a learner doing something. Neither is activity.
 */
export function isLearnerActivity(event: MoodleActivityEvent) {
  if (event.eventName.includes("webservice_function_called")) {
    return false;
  }

  return event.origin !== "cli" && event.origin !== "restore";
}
