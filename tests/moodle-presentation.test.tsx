import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PresentationView, RosterTable } from "@/components/community-impact";
import { parseRosterParams, type ImpactMetricsRow } from "@/lib/moodle/impact";
import type { RosterEntry } from "@/lib/moodle/queries";

const metrics: ImpactMetricsRow = {
  completedCourseEnrollments: 12,
  conflictLearners: 0,
  currentlyTakingCourses: 18,
  earliestObservedAt: "2026-01-04T00:00:00.000Z",
  eligibleCourseEnrollments: 40,
  lastFailedSyncAt: null,
  lastSuccessfulSyncAt: "2026-09-01T11:00:00.000Z",
  matchedLearners: 15,
  studentsEnrolledAllTime: 23,
  totalCourseEnrollments: 44,
  trackedCourses: 4,
  unmatchedLearners: 8,
};

const roster: RosterEntry[] = [
  {
    active_course_names: ["Access Control"],
    active_enrollments: 1,
    course_ids: [9],
    course_names: ["Access Control"],
    courses_completed: 1,
    courses_enrolled: 2,
    email: "ada.lovelace@example.com",
    first_name: "Ada",
    first_name_sort: "ada",
    last_access_at: "2026-08-30T00:00:00.000Z",
    last_name: "Lovelace",
    last_name_sort: "lovelace",
    last_seen_at: "2026-09-01T11:00:00.000Z",
    latest_completed_at: "2026-06-02T00:00:00.000Z",
    match_status: "matched",
    moodle_user_id: 41,
    profile_id: "profile-1",
    progress_percentage: null,
  },
];

const pii = ["Lovelace", "Ada", "ada.lovelace@example.com", "41"];

describe("presentation mode privacy", () => {
  it("shows the four aggregates and no student information", () => {
    const html = renderToStaticMarkup(
      <PresentationView metrics={metrics} params={parseRosterParams({})} />,
    );

    expect(html).toContain("DigitalRCC Community Impact");
    expect(html).toContain("Students Enrolled");
    expect(html).toContain("Currently Taking Courses");
    expect(html).toContain("Total Course Enrollments");
    expect(html).toContain("Courses Completed");
    expect(html).toContain("Data updated");
    expect(html).toContain("Exit Presentation Mode");

    for (const value of pii) {
      expect(html).not.toContain(value);
    }

    expect(html).not.toContain("Sync Now");
    expect(html).not.toContain("Moodle ID");
    expect(html).not.toContain("@");
  });

  it("shows the roster only outside presentation mode", () => {
    const html = renderToStaticMarkup(
      <RosterTable entries={roster} params={parseRosterParams({})} total={1} />,
    );

    for (const value of ["Lovelace", "Ada", "ada.lovelace@example.com"]) {
      expect(html).toContain(value);
    }

    expect(html).toContain("Showing 1–1 of 1");
  });
});
