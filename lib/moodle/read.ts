import { MoodleError, type MoodleClient } from "@/lib/moodle/client";
import {
  courseFromMoodle,
  participantFromMoodle,
  toCompletionState,
  toIsoTimestamp,
  type CompletionState,
  type MoodleCourseRecord,
  type MoodleParticipant,
} from "@/lib/moodle/transform";

export type CompletionLookup = {
  completedAt: string | null;
  state: CompletionState;
};

export async function readCourses(
  client: MoodleClient,
  trackedCourseIds: number[],
): Promise<MoodleCourseRecord[]> {
  const payload = await client.call<{ courses?: Record<string, unknown>[] }>(
    "core_course_get_courses_by_field",
    trackedCourseIds.length
      ? { field: "ids", value: trackedCourseIds.join(",") }
      : {},
  );

  return (payload.courses ?? [])
    .map((course) => courseFromMoodle(course))
    .filter((course): course is MoodleCourseRecord => Boolean(course))
    .filter((course) => course.moodleCourseId > 1);
}

export async function readParticipants(
  client: MoodleClient,
  courseId: number,
): Promise<MoodleParticipant[]> {
  const payload = await client.call<Record<string, unknown>[]>(
    "core_enrol_get_enrolled_users",
    { courseid: courseId },
  );

  return (Array.isArray(payload) ? payload : [])
    .map((user) => participantFromMoodle(user))
    .filter((user): user is MoodleParticipant => Boolean(user));
}

/**
 * Completion tracking being switched off for a course is "unknown", never
 * "not completed". A network failure still propagates so the run is recorded
 * as failed instead of silently wiping completion data.
 */
export async function readCompletion(
  client: MoodleClient,
  courseId: number,
  moodleUserId: number,
): Promise<CompletionLookup> {
  try {
    const payload = await client.call<{
      completionstatus?: { completed?: boolean; timecompleted?: number };
    }>("core_completion_get_course_completion_status", {
      courseid: courseId,
      userid: moodleUserId,
    });
    const status = payload.completionstatus;

    if (!status) {
      return { completedAt: null, state: "unknown" };
    }

    return {
      completedAt: toIsoTimestamp(status.timecompleted),
      state: toCompletionState({ completed: status.completed }),
    };
  } catch (error) {
    if (error instanceof MoodleError && error.code !== "unreachable") {
      return { completedAt: null, state: "unknown" };
    }

    throw error;
  }
}
