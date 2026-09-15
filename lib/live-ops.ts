/**
 * Shaping of the Live Operations query and its freshness vocabulary. Pure
 * helpers only: the Supabase reads live in lib/moodle/live-ops-queries.ts.
 */

import {
  parseActivityWindow,
  type ActivityWindow,
} from "@/lib/moodle/activity";

export type ActivityFilter = "any" | "active_in_window" | "idle_in_window";
export type AttentionFilter = "any" | "needs_attention";
export type SessionFilter = "any" | "in_session";
export type LiveOpsSort = "name" | "activity";
export type SortDirection = "asc" | "desc";

export type LiveOpsParams = {
  activity: ActivityFilter;
  attention: AttentionFilter;
  cohort: number | null;
  courseId: number | null;
  direction: SortDirection;
  page: number;
  perPage: number;
  pod: string | null;
  search: string;
  session: SessionFilter;
  sort: LiveOpsSort;
  window: ActivityWindow;
};

export const liveOpsPerPageOptions = [25, 50, 100];

export const defaultLiveOpsParams: LiveOpsParams = {
  activity: "any",
  attention: "any",
  cohort: null,
  courseId: null,
  direction: "asc",
  page: 1,
  perPage: 25,
  pod: null,
  search: "",
  session: "any",
  sort: "name",
  window: "2h",
};

/** How long a connector may go without a successful run before we say so. */
export const freshnessThresholds = {
  currentMinutes: 10,
  delayedMinutes: 60,
};

export type ConnectorFreshness = "current" | "delayed" | "stale" | "unavailable";

function readSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readInteger(value: string | string[] | undefined) {
  const raw = readSingle(value);
  const parsed = Number(raw);

  return raw && Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function parseLiveOpsParams(
  raw: Record<string, string | string[] | undefined>,
): LiveOpsParams {
  const activity = readSingle(raw.activity);
  const attention = readSingle(raw.attention);
  const session = readSingle(raw.session);
  const sort = readSingle(raw.sort);
  const direction = readSingle(raw.direction);
  const perPage = readInteger(raw.perPage);
  const page = readInteger(raw.page);
  const cohort = readInteger(raw.cohort);
  const courseId = readInteger(raw.courseId);
  const pod = readSingle(raw.pod)?.trim();

  return {
    activity:
      activity === "active_in_window" || activity === "idle_in_window"
        ? activity
        : "any",
    attention: attention === "needs_attention" ? "needs_attention" : "any",
    cohort: cohort && cohort > 0 ? cohort : null,
    courseId: courseId && courseId > 0 ? courseId : null,
    direction: direction === "desc" ? "desc" : "asc",
    page: page && page > 0 ? page : 1,
    perPage:
      perPage && liveOpsPerPageOptions.includes(perPage)
        ? perPage
        : defaultLiveOpsParams.perPage,
    pod: pod || null,
    search: readSingle(raw.search)?.trim().slice(0, 120) ?? "",
    session: session === "in_session" ? "in_session" : "any",
    sort: sort === "activity" ? "activity" : "name",
    window: parseActivityWindow(readSingle(raw.window)),
  };
}

export function liveOpsRange(params: LiveOpsParams) {
  const from = (params.page - 1) * params.perPage;

  return { from, to: from + params.perPage - 1 };
}

export function liveOpsPageCount(total: number, perPage: number) {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

/**
 * Builds a Live Operations URL from the current parameters plus an override.
 * Anything left at its default is omitted so the address stays readable.
 */
export function buildLiveOpsHref(
  params: LiveOpsParams,
  overrides: Partial<LiveOpsParams> = {},
  basePath = "/admin/community-impact/live",
) {
  const merged = { ...params, ...overrides };
  const search = new URLSearchParams();

  if (merged.search) {
    search.set("search", merged.search);
  }
  if (merged.window !== defaultLiveOpsParams.window) {
    search.set("window", merged.window);
  }
  if (merged.activity !== "any") {
    search.set("activity", merged.activity);
  }
  if (merged.attention !== "any") {
    search.set("attention", merged.attention);
  }
  if (merged.session !== "any") {
    search.set("session", merged.session);
  }
  if (merged.cohort) {
    search.set("cohort", String(merged.cohort));
  }
  if (merged.courseId) {
    search.set("courseId", String(merged.courseId));
  }
  if (merged.pod) {
    search.set("pod", merged.pod);
  }
  if (merged.sort !== "name") {
    search.set("sort", merged.sort);
  }
  if (merged.direction !== "asc") {
    search.set("direction", merged.direction);
  }
  if (merged.perPage !== defaultLiveOpsParams.perPage) {
    search.set("perPage", String(merged.perPage));
  }
  if (merged.page > 1) {
    search.set("page", String(merged.page));
  }

  const query = search.toString();

  return query ? `${basePath}?${query}` : basePath;
}

export function classifyFreshness(
  lastSuccessAt: string | null,
  now: Date = new Date(),
): ConnectorFreshness {
  if (!lastSuccessAt) {
    return "unavailable";
  }

  const observed = new Date(lastSuccessAt);

  if (Number.isNaN(observed.getTime())) {
    return "unavailable";
  }

  const minutes = (now.getTime() - observed.getTime()) / 60_000;

  if (minutes <= freshnessThresholds.currentMinutes) {
    return "current";
  }
  if (minutes <= freshnessThresholds.delayedMinutes) {
    return "delayed";
  }

  return "stale";
}

export const freshnessLabels: Record<ConnectorFreshness, string> = {
  current: "Up to date",
  delayed: "Delayed",
  stale: "Stale",
  unavailable: "No successful collection",
};

export const connectorLabels: Record<string, string> = {
  guacamole_sessions: "Guacamole sessions",
  moodle_activity: "Moodle activity events",
  moodle_login_failures: "Moodle failed logins",
};
