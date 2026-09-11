import { describe, expect, it } from "vitest";

import {
  classifyAccount,
  courseFromMoodle,
  matchProfile,
  mergeEnrollment,
  normalizeEmail,
  parseExcludedPatterns,
  parseTrackedCourseIds,
  participantFromMoodle,
  toCompletionState,
  toIsoTimestamp,
} from "@/lib/moodle/transform";

const patterns = parseExcludedPatterns(undefined);

function participant(overrides: Record<string, unknown> = {}) {
  return {
    email: "Ada.Lovelace@example.com",
    firstname: "Ada",
    id: 41,
    lastcourseaccess: 1_756_000_000,
    lastname: "Lovelace",
    roles: [{ shortname: "student" }],
    username: "alovelace",
    ...overrides,
  };
}

describe("moodle transform", () => {
  it("normalizes emails and timestamps", () => {
    expect(normalizeEmail("  ADA@Example.com ")).toBe("ada@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(toIsoTimestamp(0)).toBeNull();
    expect(toIsoTimestamp(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("parses tracked course ids and drops junk", () => {
    expect(parseTrackedCourseIds(" 4, 7,7 , x, -2 ")).toEqual([4, 7]);
    expect(parseTrackedCourseIds(undefined)).toEqual([]);
  });

  it("keeps student accounts and excludes staff, service and test accounts", () => {
    const student = participantFromMoodle(participant());
    expect(student).not.toBeNull();
    expect(classifyAccount(student!, patterns)).toEqual({
      excluded: false,
      reason: null,
    });

    const teacher = participantFromMoodle(
      participant({ id: 42, roles: [{ shortname: "editingteacher" }] }),
    );
    expect(classifyAccount(teacher!, patterns).excluded).toBe(true);

    const noRole = participantFromMoodle(participant({ id: 43, roles: [] }));
    expect(classifyAccount(noRole!, patterns).excluded).toBe(true);

    const testAccount = participantFromMoodle(
      participant({ email: "qa.test@example.com", id: 44 }),
    );
    expect(classifyAccount(testAccount!, patterns).excluded).toBe(true);

    const serviceAccount = participantFromMoodle(
      participant({ id: 45, username: "svc-integration" }),
    );
    expect(classifyAccount(serviceAccount!, patterns).excluded).toBe(true);
  });

  it("treats missing completion tracking as unknown, never as incomplete", () => {
    expect(toCompletionState({ completed: true })).toBe("complete");
    expect(toCompletionState({ completed: false })).toBe("incomplete");
    expect(toCompletionState({})).toBe("unknown");
    expect(toCompletionState({ completed: true, trackingEnabled: false })).toBe(
      "unknown",
    );
  });

  it("reads suspended enrollments and course records", () => {
    const suspended = participantFromMoodle(
      participant({ id: 46, suspended: true }),
    );
    expect(suspended?.enrollmentStatus).toBe("suspended");

    const course = courseFromMoodle({
      categoryname: "CMMC",
      fullname: "Access Control",
      id: 9,
      shortname: "AC",
      visible: 1,
    });
    expect(course).toEqual({
      categoryName: "CMMC",
      endDate: null,
      fullName: "Access Control",
      moodleCourseId: 9,
      shortName: "AC",
      startDate: null,
      visible: true,
    });
    expect(courseFromMoodle({ id: "x" })).toBeNull();
  });

  it("links a learner to a portal profile only on an exact unique email", () => {
    const profiles = [
      { email: "ada.lovelace@example.com", id: "profile-1" },
      { email: "grace@example.com", id: "profile-2" },
      { email: "Grace@example.com", id: "profile-3" },
    ];

    expect(matchProfile("ADA.Lovelace@example.com", profiles)).toEqual({
      matchNote: null,
      matchStatus: "matched",
      profileId: "profile-1",
    });
    expect(matchProfile("nobody@example.com", profiles).matchStatus).toBe(
      "unmatched",
    );
    expect(matchProfile(null, profiles).matchStatus).toBe("unmatched");
    expect(matchProfile("grace@example.com", profiles)).toMatchObject({
      matchStatus: "conflict",
      profileId: null,
    });
  });

  it("keeps first enrollment date and recorded completion across repeat syncs", () => {
    const observation = {
      completedAt: null,
      completionState: "unknown" as const,
      enrollmentStatus: "active" as const,
      firstEnrolledAt: "2026-05-01T00:00:00.000Z",
      lastAccessAt: "2026-08-01T00:00:00.000Z",
      moodleCourseId: 9,
      moodleUserId: 41,
      progressPercentage: null,
      roleShortname: "student",
    };
    const existing = {
      completedAt: "2026-06-01T00:00:00.000Z",
      completionState: "complete" as const,
      firstEnrolledAt: "2026-01-02T00:00:00.000Z",
      moodleCourseId: 9,
      moodleUserId: 41,
    };

    const merged = mergeEnrollment(
      observation,
      existing,
      "2026-09-01T00:00:00.000Z",
    );
    expect(merged.first_enrolled_at).toBe("2026-01-02T00:00:00.000Z");
    expect(merged.completion_state).toBe("complete");
    expect(merged.completed_at).toBe("2026-06-01T00:00:00.000Z");

    const fresh = mergeEnrollment(
      observation,
      undefined,
      "2026-09-01T00:00:00.000Z",
    );
    expect(fresh.first_enrolled_at).toBe("2026-05-01T00:00:00.000Z");
    expect(fresh.completion_state).toBe("unknown");
    expect(fresh.completed_at).toBeNull();
  });
});
