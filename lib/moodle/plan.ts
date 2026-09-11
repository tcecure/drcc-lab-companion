import {
  classifyAccount,
  matchProfile,
  mergeEnrollment,
  type CompletionState,
  type EnrollmentObservation,
  type ExistingEnrollment,
  type MoodleCourseRecord,
  type MoodleParticipant,
} from "@/lib/moodle/transform";

export type CourseParticipation = {
  completion: Map<
    number,
    { completedAt: string | null; state: CompletionState }
  >;
  course: MoodleCourseRecord;
  participants: MoodleParticipant[];
};

export type SyncPlanInput = {
  excludedPatterns: string[];
  existingEnrollments: ExistingEnrollment[];
  firstSeenByLearner: Map<number, string>;
  observedAt: string;
  participation: CourseParticipation[];
  profiles: { email: string | null; id: string }[];
};

export function enrollmentKey(moodleUserId: number, moodleCourseId: number) {
  return `${moodleUserId}:${moodleCourseId}`;
}

/**
 * Turns one round of Moodle observations into the exact rows to write. Kept
 * free of IO so repeated-sync behaviour is testable: the same observations
 * always produce the same rows.
 */
export function planSync(input: SyncPlanInput) {
  const existingByKey = new Map(
    input.existingEnrollments.map((enrollment) => [
      enrollmentKey(enrollment.moodleUserId, enrollment.moodleCourseId),
      enrollment,
    ]),
  );
  const learners = new Map<number, MoodleParticipant>();
  const classifications = new Map<
    number,
    { excluded: boolean; reason: string | null }
  >();
  const observations: EnrollmentObservation[] = [];

  for (const entry of input.participation) {
    for (const participant of entry.participants) {
      const classification = classifyAccount(
        participant,
        input.excludedPatterns,
      );
      const previous = classifications.get(participant.moodleUserId);

      // A learner counts as a student when any tracked course gives them the
      // student role.
      classifications.set(
        participant.moodleUserId,
        previous && !previous.excluded ? previous : classification,
      );
      learners.set(participant.moodleUserId, participant);

      if (classification.excluded) {
        continue;
      }

      const completion = entry.completion.get(participant.moodleUserId) ?? {
        completedAt: null,
        state: "unknown" as const,
      };

      observations.push({
        completedAt: completion.completedAt,
        completionState: completion.state,
        enrollmentStatus: participant.enrollmentStatus,
        firstEnrolledAt: participant.firstEnrolledAt,
        lastAccessAt: participant.lastAccessAt,
        moodleCourseId: entry.course.moodleCourseId,
        moodleUserId: participant.moodleUserId,
        progressPercentage: null,
        roleShortname: "student",
      });
    }
  }

  const learnerRows = [...learners.values()].map((participant) => {
    const classification = classifications.get(participant.moodleUserId) ?? {
      excluded: false,
      reason: null,
    };
    const match = matchProfile(participant.email, input.profiles);

    return {
      email: participant.email,
      exclusion_reason: classification.reason,
      first_name: participant.firstName,
      first_seen_at:
        input.firstSeenByLearner.get(participant.moodleUserId) ??
        input.observedAt,
      is_excluded: classification.excluded,
      last_name: participant.lastName,
      last_seen_at: input.observedAt,
      last_synced_at: input.observedAt,
      match_note: match.matchNote,
      match_status: match.matchStatus,
      moodle_user_id: participant.moodleUserId,
      profile_id: match.profileId,
      updated_at: input.observedAt,
      username: participant.username,
    };
  });

  // One row per student/course pair even if Moodle returns a learner twice.
  const enrollmentRowByKey = new Map<
    string,
    ReturnType<typeof mergeEnrollment>
  >();

  for (const observation of observations) {
    const key = enrollmentKey(
      observation.moodleUserId,
      observation.moodleCourseId,
    );
    enrollmentRowByKey.set(
      key,
      mergeEnrollment(observation, existingByKey.get(key), input.observedAt),
    );
  }

  const seenKeys = new Set(enrollmentRowByKey.keys());
  const staleEnrollments = input.existingEnrollments.filter(
    (enrollment) =>
      !seenKeys.has(
        enrollmentKey(enrollment.moodleUserId, enrollment.moodleCourseId),
      ),
  );

  return {
    enrollmentRows: [...enrollmentRowByKey.values()],
    learnerRows,
    observations,
    staleEnrollments,
  };
}
