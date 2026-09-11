import { describe, expect, it } from "vitest";

import {
  buildRosterHref,
  describeCompletion,
  describeSyncFreshness,
  emptyImpactMetrics,
  parseImpactMetrics,
  parseRosterParams,
  rosterRange,
} from "@/lib/moodle/impact";

describe("community impact metrics", () => {
  it("parses the metrics payload and tolerates junk", () => {
    const metrics = parseImpactMetrics({
      completedCourseEnrollments: 4,
      currentlyTakingCourses: 6,
      eligibleCourseEnrollments: 16,
      lastSuccessfulSyncAt: "2026-09-01T12:00:00.000Z",
      studentsEnrolledAllTime: 11,
      totalCourseEnrollments: 20,
      trackedCourses: "3",
    });

    expect(metrics.studentsEnrolledAllTime).toBe(11);
    expect(metrics.currentlyTakingCourses).toBe(6);
    expect(metrics.totalCourseEnrollments).toBe(20);
    expect(metrics.completedCourseEnrollments).toBe(4);
    expect(metrics.trackedCourses).toBe(0);
    expect(parseImpactMetrics(null)).toEqual(emptyImpactMetrics);
  });

  it("reports a completion rate, and unavailable instead of zero", () => {
    const rate = describeCompletion({
      ...emptyImpactMetrics,
      completedCourseEnrollments: 4,
      eligibleCourseEnrollments: 16,
    });
    expect(rate.available).toBe(true);
    expect(rate.rate).toBeCloseTo(0.25);
    expect(rate.value).toBe("4");
    expect(rate.label).toContain("25% completion rate");

    const unavailable = describeCompletion(emptyImpactMetrics);
    expect(unavailable.available).toBe(false);
    expect(unavailable.label).toBe("Completion data unavailable");
    expect(unavailable.value).toBe("—");
  });

  it("describes synchronization freshness", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");

    expect(describeSyncFreshness(null, now).state).toBe("unavailable");
    expect(describeSyncFreshness("2026-09-01T11:30:00.000Z", now).state).toBe(
      "current",
    );
    expect(describeSyncFreshness("2026-08-31T12:00:00.000Z", now).state).toBe(
      "delayed",
    );
  });
});

describe("roster parameters", () => {
  it("defaults to A-Z, page one, 25 rows", () => {
    const params = parseRosterParams({});

    expect(params).toEqual({
      completion: "all",
      courseId: null,
      direction: "asc",
      page: 1,
      pageSize: 25,
      search: "",
      status: "all",
    });
    expect(rosterRange(params)).toEqual({ from: 0, to: 24 });
  });

  it("accepts supported values and rejects everything else", () => {
    const params = parseRosterParams({
      completion: "complete",
      course: "7",
      dir: "desc",
      page: "3",
      pageSize: "50",
      q: "  lovelace  ",
      status: "active",
    });

    expect(params).toEqual({
      completion: "complete",
      courseId: 7,
      direction: "desc",
      page: 3,
      pageSize: 50,
      search: "lovelace",
      status: "active",
    });
    expect(rosterRange(params)).toEqual({ from: 100, to: 149 });

    const rejected = parseRosterParams({
      completion: "maybe",
      course: "abc",
      dir: "sideways",
      page: "-4",
      pageSize: "1000",
      status: "unknown",
    });

    expect(rejected).toEqual({
      completion: "all",
      courseId: null,
      direction: "asc",
      page: 1,
      pageSize: 25,
      search: "",
      status: "all",
    });
  });

  it("builds hrefs that keep filters and toggle presentation mode", () => {
    const params = parseRosterParams({
      dir: "desc",
      q: "ada",
      status: "active",
    });

    expect(buildRosterHref(params, { page: 2 })).toBe(
      "/admin/community-impact?q=ada&status=active&dir=desc&page=2",
    );
    expect(buildRosterHref(params, { presentation: true })).toContain(
      "mode=presentation",
    );
    expect(buildRosterHref(parseRosterParams({}), {})).toBe(
      "/admin/community-impact",
    );
  });
});
