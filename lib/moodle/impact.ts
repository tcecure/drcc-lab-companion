/**
 * Shaping of the Community Impact metrics and roster query. The pure helpers
 * here are what the tests assert against; the Supabase reads live in
 * lib/moodle/queries.ts.
 */

export type ImpactMetricsRow = {
  studentsEnrolledAllTime: number;
  currentlyTakingCourses: number;
  totalCourseEnrollments: number;
  completedCourseEnrollments: number;
  eligibleCourseEnrollments: number;
  earliestObservedAt: string | null;
  trackedCourses: number;
  matchedLearners: number;
  unmatchedLearners: number;
  conflictLearners: number;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
};

export type SyncFreshness = "current" | "delayed" | "unavailable";

export const emptyImpactMetrics: ImpactMetricsRow = {
  completedCourseEnrollments: 0,
  conflictLearners: 0,
  currentlyTakingCourses: 0,
  earliestObservedAt: null,
  eligibleCourseEnrollments: 0,
  lastFailedSyncAt: null,
  lastSuccessfulSyncAt: null,
  matchedLearners: 0,
  studentsEnrolledAllTime: 0,
  totalCourseEnrollments: 0,
  trackedCourses: 0,
  unmatchedLearners: 0,
};

function readNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readTimestamp(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value ? value : null;
}

export function parseImpactMetrics(payload: unknown): ImpactMetricsRow {
  if (!payload || typeof payload !== "object") {
    return emptyImpactMetrics;
  }

  const source = payload as Record<string, unknown>;

  return {
    completedCourseEnrollments: readNumber(
      source,
      "completedCourseEnrollments",
    ),
    conflictLearners: readNumber(source, "conflictLearners"),
    currentlyTakingCourses: readNumber(source, "currentlyTakingCourses"),
    earliestObservedAt: readTimestamp(source, "earliestObservedAt"),
    eligibleCourseEnrollments: readNumber(source, "eligibleCourseEnrollments"),
    lastFailedSyncAt: readTimestamp(source, "lastFailedSyncAt"),
    lastSuccessfulSyncAt: readTimestamp(source, "lastSuccessfulSyncAt"),
    matchedLearners: readNumber(source, "matchedLearners"),
    studentsEnrolledAllTime: readNumber(source, "studentsEnrolledAllTime"),
    totalCourseEnrollments: readNumber(source, "totalCourseEnrollments"),
    trackedCourses: readNumber(source, "trackedCourses"),
    unmatchedLearners: readNumber(source, "unmatchedLearners"),
  };
}

/**
 * Completion rate is only meaningful when Moodle actually reports completion
 * tracking for at least one enrollment; otherwise the page says the data is
 * unavailable rather than showing a misleading zero.
 */
export function describeCompletion(metrics: ImpactMetricsRow) {
  if (metrics.eligibleCourseEnrollments <= 0) {
    return {
      available: false as const,
      label: "Completion data unavailable",
      rate: null,
      value: "—",
    };
  }

  const rate =
    metrics.completedCourseEnrollments / metrics.eligibleCourseEnrollments;

  return {
    available: true as const,
    label: `${Math.round(rate * 1000) / 10}% completion rate (${metrics.completedCourseEnrollments} of ${metrics.eligibleCourseEnrollments} eligible enrollments)`,
    rate,
    value: String(metrics.completedCourseEnrollments),
  };
}

export function describeSyncFreshness(
  lastSuccessfulSyncAt: string | null,
  now: Date = new Date(),
  delayedAfterMinutes = 180,
): { detail: string; state: SyncFreshness } {
  if (!lastSuccessfulSyncAt) {
    return {
      detail: "No successful Moodle synchronization has completed yet.",
      state: "unavailable",
    };
  }

  const ageMinutes =
    (now.getTime() - new Date(lastSuccessfulSyncAt).getTime()) / 60000;

  if (!Number.isFinite(ageMinutes)) {
    return {
      detail: "The last synchronization time could not be read.",
      state: "unavailable",
    };
  }

  if (ageMinutes > delayedAfterMinutes) {
    return {
      detail: `Last successful synchronization was ${Math.round(ageMinutes / 60)} hours ago, so these numbers may be behind Moodle.`,
      state: "delayed",
    };
  }

  return {
    detail: "These numbers reflect the most recent Moodle synchronization.",
    state: "current",
  };
}

export const rosterPageSizes = [25, 50] as const;
export type RosterPageSize = (typeof rosterPageSizes)[number];
export type RosterSortDirection = "asc" | "desc";

export type RosterParams = {
  completion: "all" | "complete" | "incomplete";
  courseId: number | null;
  direction: RosterSortDirection;
  page: number;
  pageSize: RosterPageSize;
  search: string;
  status: "all" | "active" | "inactive";
};

export const defaultRosterParams: RosterParams = {
  completion: "all",
  courseId: null,
  direction: "asc",
  page: 1,
  pageSize: 25,
  search: "",
  status: "all",
};

function firstValue(input: string | string[] | undefined) {
  return Array.isArray(input) ? input[0] : input;
}

export function parseRosterParams(
  searchParams: Record<string, string | string[] | undefined>,
): RosterParams {
  const rawPageSize = Number.parseInt(
    firstValue(searchParams.pageSize) ?? "",
    10,
  );
  const rawPage = Number.parseInt(firstValue(searchParams.page) ?? "", 10);
  const rawCourse = Number.parseInt(firstValue(searchParams.course) ?? "", 10);
  const direction = firstValue(searchParams.dir);
  const status = firstValue(searchParams.status);
  const completion = firstValue(searchParams.completion);

  return {
    completion:
      completion === "complete" || completion === "incomplete"
        ? completion
        : "all",
    courseId: Number.isInteger(rawCourse) && rawCourse > 0 ? rawCourse : null,
    direction: direction === "desc" ? "desc" : "asc",
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: rosterPageSizes.includes(rawPageSize as RosterPageSize)
      ? (rawPageSize as RosterPageSize)
      : 25,
    search: (firstValue(searchParams.q) ?? "").trim().slice(0, 80),
    status: status === "active" || status === "inactive" ? status : "all",
  };
}

export function rosterRange(params: RosterParams) {
  const from = (params.page - 1) * params.pageSize;
  return { from, to: from + params.pageSize - 1 };
}

export function buildRosterHref(
  params: RosterParams,
  overrides: Partial<RosterParams> & { presentation?: boolean },
) {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();

  if (merged.search) {
    query.set("q", merged.search);
  }

  if (merged.courseId) {
    query.set("course", String(merged.courseId));
  }

  if (merged.status !== "all") {
    query.set("status", merged.status);
  }

  if (merged.completion !== "all") {
    query.set("completion", merged.completion);
  }

  if (merged.direction !== "asc") {
    query.set("dir", merged.direction);
  }

  if (merged.pageSize !== 25) {
    query.set("pageSize", String(merged.pageSize));
  }

  if (merged.page > 1) {
    query.set("page", String(merged.page));
  }

  if (overrides.presentation) {
    query.set("mode", "presentation");
  }

  const suffix = query.toString();
  return suffix
    ? `/admin/community-impact?${suffix}`
    : "/admin/community-impact";
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    timeZoneName: "short",
    year: "numeric",
  });
}
