import { describe, expect, it, vi } from "vitest";

import { createMoodleClient } from "@/lib/moodle/client";
import { enrollmentKey, planSync } from "@/lib/moodle/plan";
import {
  readCompletion,
  readCourses,
  readParticipants,
} from "@/lib/moodle/read";
import {
  parseExcludedPatterns,
  type ExistingEnrollment,
  type MoodleParticipant,
} from "@/lib/moodle/transform";

const observedAt = "2026-09-01T00:00:00.000Z";
const patterns = parseExcludedPatterns(undefined);
const course = {
  categoryName: "CMMC",
  endDate: null,
  fullName: "Access Control",
  moodleCourseId: 9,
  shortName: "AC",
  startDate: null,
  visible: true,
};

function learner(
  overrides: Partial<MoodleParticipant> = {},
): MoodleParticipant {
  return {
    email: "ada@example.com",
    enrollmentStatus: "active",
    firstEnrolledAt: "2026-01-01T00:00:00.000Z",
    firstName: "Ada",
    lastAccessAt: "2026-08-01T00:00:00.000Z",
    lastName: "Lovelace",
    moodleUserId: 41,
    roles: ["student"],
    username: "alovelace",
    ...overrides,
  };
}

function plan(
  participants: MoodleParticipant[],
  options: {
    completion?: Map<
      number,
      {
        completedAt: string | null;
        state: "complete" | "incomplete" | "unknown";
      }
    >;
    existingEnrollments?: ExistingEnrollment[];
    firstSeen?: Map<number, string>;
    profiles?: { email: string | null; id: string }[];
  } = {},
) {
  return planSync({
    excludedPatterns: patterns,
    existingEnrollments: options.existingEnrollments ?? [],
    firstSeenByLearner: options.firstSeen ?? new Map(),
    observedAt,
    participation: [
      {
        completion: options.completion ?? new Map(),
        course,
        participants,
      },
    ],
    profiles: options.profiles ?? [
      { email: "ada@example.com", id: "profile-1" },
    ],
  });
}

describe("moodle sync planning", () => {
  it("writes one learner and one enrollment on an initial sync", () => {
    const result = plan([learner()], {
      completion: new Map([
        [41, { completedAt: null, state: "incomplete" as const }],
      ]),
    });

    expect(result.learnerRows).toHaveLength(1);
    expect(result.learnerRows[0]).toMatchObject({
      first_seen_at: observedAt,
      is_excluded: false,
      match_status: "matched",
      moodle_user_id: 41,
      profile_id: "profile-1",
    });
    expect(result.enrollmentRows).toHaveLength(1);
    expect(result.enrollmentRows[0]).toMatchObject({
      completion_state: "incomplete",
      enrollment_status: "active",
      first_enrolled_at: "2026-01-01T00:00:00.000Z",
      moodle_course_id: 9,
      moodle_user_id: 41,
    });
  });

  it("is idempotent: a repeated sync neither duplicates nor rewrites history", () => {
    const existing: ExistingEnrollment[] = [
      {
        completedAt: "2026-05-01T00:00:00.000Z",
        completionState: "complete",
        firstEnrolledAt: "2026-01-01T00:00:00.000Z",
        moodleCourseId: 9,
        moodleUserId: 41,
      },
    ];
    const firstSeen = new Map([[41, "2026-01-01T00:00:00.000Z"]]);

    const first = plan([learner()], {
      completion: new Map([
        [
          41,
          {
            completedAt: "2026-05-01T00:00:00.000Z",
            state: "complete" as const,
          },
        ],
      ]),
      existingEnrollments: existing,
      firstSeen,
    });
    const second = plan([learner()], {
      completion: new Map([
        [
          41,
          {
            completedAt: "2026-05-01T00:00:00.000Z",
            state: "complete" as const,
          },
        ],
      ]),
      existingEnrollments: existing,
      firstSeen,
    });

    expect(second.enrollmentRows).toEqual(first.enrollmentRows);
    expect(second.enrollmentRows).toHaveLength(1);
    expect(second.learnerRows[0].first_seen_at).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(second.staleEnrollments).toHaveLength(0);
  });

  it("collapses a learner Moodle returns twice in the same course", () => {
    const result = plan([learner(), learner()]);

    expect(result.observations).toHaveLength(2);
    expect(result.enrollmentRows).toHaveLength(1);
    expect(result.learnerRows).toHaveLength(1);
  });

  it("excludes teaching and test accounts but still records why", () => {
    const result = plan([
      learner(),
      learner({
        email: "teach@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        moodleUserId: 42,
        roles: ["editingteacher"],
      }),
      learner({
        email: "qa.test@example.com",
        moodleUserId: 43,
        username: "qatest",
      }),
    ]);

    expect(result.enrollmentRows).toHaveLength(1);
    expect(result.learnerRows).toHaveLength(3);
    const excluded = result.learnerRows.filter((row) => row.is_excluded);
    expect(excluded.map((row) => row.moodle_user_id)).toEqual([42, 43]);
    expect(excluded[0].exclusion_reason).toContain("teaching");
  });

  it("flags an unmatched portal user and a changed email without creating accounts", () => {
    const changedEmail = plan([learner({ email: "ada.new@example.com" })]);

    expect(changedEmail.learnerRows[0]).toMatchObject({
      email: "ada.new@example.com",
      match_status: "unmatched",
      moodle_user_id: 41,
      profile_id: null,
    });

    const relinked = plan([learner({ email: "ada.new@example.com" })], {
      profiles: [{ email: "ada.new@example.com", id: "profile-9" }],
    });
    expect(relinked.learnerRows[0]).toMatchObject({
      match_status: "matched",
      moodle_user_id: 41,
      profile_id: "profile-9",
    });
  });

  it("keeps missing completion tracking as unknown and reports stale enrollments", () => {
    const result = plan([learner()], {
      existingEnrollments: [
        {
          completedAt: null,
          completionState: "incomplete",
          firstEnrolledAt: "2026-01-01T00:00:00.000Z",
          moodleCourseId: 12,
          moodleUserId: 77,
        },
      ],
    });

    expect(result.enrollmentRows[0].completion_state).toBe("unknown");
    expect(result.enrollmentRows[0].completed_at).toBeNull();
    expect(result.staleEnrollments.map((entry) => entry.moodleUserId)).toEqual([
      77,
    ]);
    expect(enrollmentKey(41, 9)).toBe("41:9");
  });
});

describe("moodle read layer", () => {
  function clientFor(handler: (fn: string) => unknown) {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      return new Response(
        JSON.stringify(handler(body.get("wsfunction") ?? "")),
      );
    });

    return createMoodleClient(
      { baseUrl: "https://lms.example.com", timeoutMs: 1000, token: "t" },
      fetchImpl as unknown as typeof fetch,
      0,
    );
  }

  it("reads tracked courses and skips the site course", async () => {
    const client = clientFor(() => ({
      courses: [
        { fullname: "Site", id: 1 },
        { fullname: "Access Control", id: 9, shortname: "AC" },
      ],
    }));

    const courses = await readCourses(client, [9]);
    expect(courses.map((entry) => entry.moodleCourseId)).toEqual([9]);
  });

  it("reads participants with roles and last course access", async () => {
    const client = clientFor(() => [
      {
        email: "Ada@example.com",
        firstname: "Ada",
        id: 41,
        lastcourseaccess: 1_756_000_000,
        lastname: "Lovelace",
        roles: [{ shortname: "student" }],
      },
    ]);

    const participants = await readParticipants(client, 9);
    expect(participants[0]).toMatchObject({
      email: "ada@example.com",
      enrollmentStatus: "active",
      moodleUserId: 41,
      roles: ["student"],
    });
  });

  it("maps completion and treats a Moodle exception as unknown", async () => {
    const complete = clientFor(() => ({
      completionstatus: { completed: true, timecompleted: 1_756_000_000 },
    }));
    await expect(readCompletion(complete, 9, 41)).resolves.toMatchObject({
      state: "complete",
    });

    const disabled = clientFor(() => ({
      errorcode: "completionnotenabled",
      exception: "moodle_exception",
      message: "Completion tracking is not enabled for this course",
    }));
    await expect(readCompletion(disabled, 9, 41)).resolves.toEqual({
      completedAt: null,
      state: "unknown",
    });
  });

  it("propagates an unreachable Moodle so the run is recorded as failed", async () => {
    const client = createMoodleClient(
      { baseUrl: "https://lms.example.com", timeoutMs: 1000, token: "t" },
      (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
      0,
    );

    await expect(readCourses(client, [])).rejects.toMatchObject({
      code: "unreachable",
    });
    await expect(readCompletion(client, 9, 41)).rejects.toMatchObject({
      code: "unreachable",
    });
  });
});
