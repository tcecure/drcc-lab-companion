import "server-only";

import { readServerEnv } from "@/lib/env";
import {
  createMoodleClient,
  MoodleError,
  readMoodleConfig,
  redactToken,
  type MoodleClient,
} from "@/lib/moodle/client";
import {
  enrollmentKey,
  planSync,
  type CourseParticipation,
} from "@/lib/moodle/plan";
import {
  readCompletion,
  readCourses,
  readParticipants,
} from "@/lib/moodle/read";
import {
  parseExcludedPatterns,
  parseTrackedCourseIds,
} from "@/lib/moodle/transform";
import { createAdminClient } from "@/lib/supabase/admin";

export type SyncMode = "full" | "incremental";
export type SyncTrigger = "scheduled" | "admin" | "manual";

export type SyncResult = {
  coursesSeen: number;
  enrollmentsSeen: number;
  enrollmentsWritten: number;
  learnersSeen: number;
  mode: SyncMode;
  runId: string | null;
  skipped?: "already_running";
  status: "succeeded" | "skipped";
};

async function collectParticipation(
  client: MoodleClient,
  mode: SyncMode,
  trackedCourseIds: number[],
  existingCompletion: Map<string, { completedAt: string | null }>,
): Promise<CourseParticipation[]> {
  const courses = await readCourses(client, trackedCourseIds);
  const participation: CourseParticipation[] = [];

  for (const course of courses) {
    const participants = await readParticipants(client, course.moodleCourseId);
    const completion: CourseParticipation["completion"] = new Map();

    for (const participant of participants) {
      const key = enrollmentKey(
        participant.moodleUserId,
        course.moodleCourseId,
      );
      const settled = existingCompletion.get(key);

      // An incremental run trusts a completion Moodle already confirmed and
      // only re-checks enrollments that are not complete yet.
      if (mode === "incremental" && settled) {
        completion.set(participant.moodleUserId, {
          completedAt: settled.completedAt,
          state: "complete",
        });
        continue;
      }

      completion.set(
        participant.moodleUserId,
        await readCompletion(
          client,
          course.moodleCourseId,
          participant.moodleUserId,
        ),
      );
    }

    participation.push({ completion, course, participants });
  }

  return participation;
}

export async function runMoodleSync(
  mode: SyncMode,
  trigger: SyncTrigger,
): Promise<SyncResult> {
  const env = readServerEnv();
  const config = readMoodleConfig();

  if (!config) {
    throw new MoodleError(
      "Moodle is not configured: MOODLE_BASE_URL and MOODLE_API_TOKEN are required.",
      "not_configured",
    );
  }

  const supabase = createAdminClient();
  const { data: runId, error: runError } = await supabase.rpc(
    "moodle_start_sync_run",
    { run_mode: mode, run_trigger: trigger },
  );

  if (runError) {
    throw new MoodleError(runError.message, "sync_run_start_failed");
  }

  if (!runId) {
    return {
      coursesSeen: 0,
      enrollmentsSeen: 0,
      enrollmentsWritten: 0,
      learnersSeen: 0,
      mode,
      runId: null,
      skipped: "already_running",
      status: "skipped",
    };
  }

  const observedAt = new Date().toISOString();
  const client = createMoodleClient(config);

  try {
    await client.call("core_webservice_get_site_info");

    const [
      { data: profiles },
      { data: existingLearners },
      { data: existingEnrollmentRows },
    ] = await Promise.all([
      supabase.from("profiles").select("id, email"),
      supabase.from("moodle_learners").select("moodle_user_id, first_seen_at"),
      supabase
        .from("moodle_course_enrollments")
        .select(
          "moodle_user_id, moodle_course_id, first_enrolled_at, completion_state, completed_at",
        ),
    ]);

    const existingEnrollments = (existingEnrollmentRows ?? []).map((row) => ({
      completedAt: row.completed_at,
      completionState: row.completion_state,
      firstEnrolledAt: row.first_enrolled_at,
      moodleCourseId: row.moodle_course_id,
      moodleUserId: row.moodle_user_id,
    }));
    const settledCompletion = new Map(
      existingEnrollments
        .filter((enrollment) => enrollment.completionState === "complete")
        .map((enrollment) => [
          enrollmentKey(enrollment.moodleUserId, enrollment.moodleCourseId),
          { completedAt: enrollment.completedAt },
        ]),
    );

    const participation = await collectParticipation(
      client,
      mode,
      parseTrackedCourseIds(env.MOODLE_TRACKED_COURSE_IDS),
      settledCompletion,
    );

    if (participation.length) {
      const { error } = await supabase.from("moodle_catalog_courses").upsert(
        participation.map(({ course }) => ({
          category_name: course.categoryName,
          end_date: course.endDate,
          full_name: course.fullName,
          last_seen_at: observedAt,
          moodle_course_id: course.moodleCourseId,
          short_name: course.shortName,
          start_date: course.startDate,
          tracked: true,
          updated_at: observedAt,
          visible: course.visible,
        })),
        { onConflict: "moodle_course_id" },
      );

      if (error) {
        throw new MoodleError(error.message, "course_write_failed");
      }
    }

    const plan = planSync({
      excludedPatterns: parseExcludedPatterns(
        env.MOODLE_EXCLUDED_ACCOUNT_PATTERNS,
      ),
      existingEnrollments,
      firstSeenByLearner: new Map(
        (existingLearners ?? []).map((learner) => [
          learner.moodle_user_id,
          learner.first_seen_at,
        ]),
      ),
      observedAt,
      participation,
      profiles: profiles ?? [],
    });

    if (plan.learnerRows.length) {
      const { error } = await supabase
        .from("moodle_learners")
        .upsert(plan.learnerRows, { onConflict: "moodle_user_id" });

      if (error) {
        throw new MoodleError(error.message, "learner_write_failed");
      }
    }

    if (plan.enrollmentRows.length) {
      const { error } = await supabase
        .from("moodle_course_enrollments")
        .upsert(plan.enrollmentRows, {
          onConflict: "moodle_user_id,moodle_course_id",
        });

      if (error) {
        throw new MoodleError(error.message, "enrollment_write_failed");
      }

      const { error: snapshotError } = await supabase
        .from("moodle_progress_snapshots")
        .insert(
          plan.enrollmentRows.map((row) => ({
            completion_state: row.completion_state,
            last_access_at: row.last_access_at,
            moodle_course_id: row.moodle_course_id,
            moodle_user_id: row.moodle_user_id,
            observed_at: observedAt,
            progress_percentage: row.progress_percentage,
            sync_run_id: runId,
          })),
        );

      if (snapshotError) {
        throw new MoodleError(snapshotError.message, "snapshot_write_failed");
      }
    }

    if (mode === "full" && plan.staleEnrollments.length) {
      // Enrollments Moodle no longer reports stay as history, marked inactive.
      const courseIds = participation.map(
        ({ course }) => course.moodleCourseId,
      );
      const { error } = await supabase
        .from("moodle_course_enrollments")
        .update({
          enrollment_status: "inactive",
          last_synced_at: observedAt,
          updated_at: observedAt,
        })
        .in("moodle_course_id", courseIds)
        .in(
          "moodle_user_id",
          plan.staleEnrollments.map((enrollment) => enrollment.moodleUserId),
        )
        .neq("enrollment_status", "inactive");

      if (error) {
        throw new MoodleError(error.message, "stale_write_failed");
      }
    }

    const result: SyncResult = {
      coursesSeen: participation.length,
      enrollmentsSeen: plan.observations.length,
      enrollmentsWritten: plan.enrollmentRows.length,
      learnersSeen: plan.learnerRows.filter((row) => !row.is_excluded).length,
      mode,
      runId,
      status: "succeeded",
    };

    await supabase
      .from("moodle_sync_runs")
      .update({
        courses_seen: result.coursesSeen,
        enrollments_seen: result.enrollmentsSeen,
        enrollments_written: result.enrollmentsWritten,
        finished_at: new Date().toISOString(),
        learners_seen: result.learnersSeen,
        status: "succeeded",
      })
      .eq("id", runId);

    return result;
  } catch (error) {
    const message = redactToken(
      error instanceof Error ? error.message : "Moodle sync failed.",
      config.token,
    );

    await supabase
      .from("moodle_sync_runs")
      .update({
        error_message: message.slice(0, 500),
        finished_at: new Date().toISOString(),
        status: "failed",
      })
      .eq("id", runId);

    throw error instanceof MoodleError
      ? error
      : new MoodleError(message, "sync_failed");
  }
}
