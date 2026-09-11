/**
 * Pure translation between Moodle web service payloads and the portal's
 * Community Impact projection. Nothing here talks to Moodle or Supabase.
 */

export type CompletionState = "complete" | "incomplete" | "unknown";
export type EnrollmentStatus = "active" | "suspended" | "inactive";
export type MatchStatus = "matched" | "unmatched" | "conflict";

export type MoodleCourseRecord = {
  categoryName: string | null;
  endDate: string | null;
  fullName: string;
  moodleCourseId: number;
  shortName: string;
  startDate: string | null;
  visible: boolean;
};

export type MoodleParticipant = {
  email: string | null;
  enrollmentStatus: EnrollmentStatus;
  firstEnrolledAt: string | null;
  firstName: string;
  lastAccessAt: string | null;
  lastName: string;
  moodleUserId: number;
  roles: string[];
  username: string | null;
};

const studentRoleShortNames = new Set(["student", "frontpagestudent"]);
const staffRoleShortNames = new Set([
  "coursecreator",
  "editingteacher",
  "manager",
  "teacher",
]);

const defaultExcludedPatterns = [
  "test",
  "demo",
  "svc-",
  "service",
  "noreply",
  "no-reply",
  "admin",
  "guest",
];

export function normalizeEmail(email: string | null | undefined) {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed || null;
}

export function toIsoTimestamp(seconds: unknown): string | null {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

export function parseTrackedCourseIds(raw: string | undefined) {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[,\s]+/)
        .map((entry) => Number.parseInt(entry, 10))
        .filter((entry) => Number.isInteger(entry) && entry > 0),
    ),
  );
}

export function parseExcludedPatterns(raw: string | undefined) {
  const configured = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return configured.length ? configured : defaultExcludedPatterns;
}

export function hasStudentRole(roles: string[]) {
  return roles.some((role) => studentRoleShortNames.has(role.toLowerCase()));
}

export function hasStaffRole(roles: string[]) {
  return roles.some((role) => staffRoleShortNames.has(role.toLowerCase()));
}

/**
 * Staff, service and obvious test accounts never count towards community
 * impact. Excluded learners are still stored so an administrator can see why a
 * Moodle account was left out.
 */
export function classifyAccount(
  participant: Pick<MoodleParticipant, "email" | "roles" | "username">,
  excludedPatterns: string[],
): { excluded: boolean; reason: string | null } {
  if (hasStaffRole(participant.roles)) {
    return { excluded: true, reason: "Moodle role is teaching or management" };
  }

  if (!hasStudentRole(participant.roles)) {
    return { excluded: true, reason: "No student role in a tracked course" };
  }

  const haystack = [participant.email, participant.username]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.toLowerCase());

  for (const pattern of excludedPatterns) {
    if (haystack.some((entry) => entry.includes(pattern))) {
      return { excluded: true, reason: `Account matches "${pattern}"` };
    }
  }

  return { excluded: false, reason: null };
}

export function toCompletionState(input: {
  completed?: boolean | null;
  trackingEnabled?: boolean | null;
}): CompletionState {
  if (input.trackingEnabled === false) {
    return "unknown";
  }

  if (input.completed === true) {
    return "complete";
  }

  if (input.completed === false) {
    return "incomplete";
  }

  return "unknown";
}

export function courseFromMoodle(
  raw: Record<string, unknown>,
): MoodleCourseRecord | null {
  const id = Number(raw.id);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const fullName =
    typeof raw.fullname === "string" && raw.fullname.trim()
      ? raw.fullname.trim()
      : `Course ${id}`;

  return {
    categoryName:
      typeof raw.categoryname === "string" && raw.categoryname.trim()
        ? raw.categoryname.trim()
        : null,
    endDate: toIsoTimestamp(raw.enddate),
    fullName,
    moodleCourseId: id,
    shortName: typeof raw.shortname === "string" ? raw.shortname : "",
    startDate: toIsoTimestamp(raw.startdate),
    visible: raw.visible === undefined ? true : Boolean(raw.visible),
  };
}

export function participantFromMoodle(
  raw: Record<string, unknown>,
): MoodleParticipant | null {
  const id = Number(raw.id);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const roles = Array.isArray(raw.roles)
    ? raw.roles
        .map((role) =>
          role && typeof role === "object" && "shortname" in role
            ? String((role as { shortname: unknown }).shortname)
            : "",
        )
        .filter(Boolean)
    : [];

  const enrolledCourses = Array.isArray(raw.enrolledcourses)
    ? (raw.enrolledcourses as Record<string, unknown>[])
    : [];

  const timeStarted = enrolledCourses
    .map((course) => toIsoTimestamp(course.timestarted))
    .filter((entry): entry is string => Boolean(entry))
    .sort()[0];

  return {
    email: normalizeEmail(typeof raw.email === "string" ? raw.email : null),
    enrollmentStatus: raw.suspended === true ? "suspended" : "active",
    firstEnrolledAt: toIsoTimestamp(raw.firstaccess) ?? timeStarted ?? null,
    firstName: typeof raw.firstname === "string" ? raw.firstname.trim() : "",
    lastAccessAt: toIsoTimestamp(raw.lastcourseaccess ?? raw.lastaccess),
    lastName: typeof raw.lastname === "string" ? raw.lastname.trim() : "",
    moodleUserId: id,
    roles,
    username: typeof raw.username === "string" ? raw.username : null,
  };
}

/**
 * Moodle never creates a portal account. A learner is linked to an existing
 * portal profile only on an exact normalized email match, and an ambiguous
 * match is flagged for an administrator instead of guessed.
 */
export function matchProfile(
  email: string | null,
  profiles: { email: string | null; id: string }[],
): {
  matchNote: string | null;
  matchStatus: MatchStatus;
  profileId: string | null;
} {
  const normalized = normalizeEmail(email);

  if (!normalized) {
    return {
      matchNote: "Moodle account has no email address",
      matchStatus: "unmatched",
      profileId: null,
    };
  }

  const candidates = profiles.filter(
    (profile) => normalizeEmail(profile.email) === normalized,
  );

  if (candidates.length === 1) {
    return {
      matchNote: null,
      matchStatus: "matched",
      profileId: candidates[0].id,
    };
  }

  if (candidates.length > 1) {
    return {
      matchNote: `${candidates.length} portal profiles share this email address`,
      matchStatus: "conflict",
      profileId: null,
    };
  }

  return {
    matchNote: "No portal profile with this email address",
    matchStatus: "unmatched",
    profileId: null,
  };
}

export type EnrollmentObservation = {
  completionState: CompletionState;
  completedAt: string | null;
  enrollmentStatus: EnrollmentStatus;
  firstEnrolledAt: string | null;
  lastAccessAt: string | null;
  moodleCourseId: number;
  moodleUserId: number;
  progressPercentage: number | null;
  roleShortname: string;
};

export type ExistingEnrollment = {
  completedAt: string | null;
  completionState: CompletionState;
  firstEnrolledAt: string | null;
  moodleCourseId: number;
  moodleUserId: number;
};

/**
 * Merges a fresh observation with what is already stored so a repeated sync is
 * idempotent: the first enrollment date and a recorded completion are never
 * overwritten with weaker information.
 */
export function mergeEnrollment(
  observation: EnrollmentObservation,
  existing: ExistingEnrollment | undefined,
  observedAt: string,
) {
  const completionState =
    observation.completionState === "unknown" && existing
      ? existing.completionState
      : observation.completionState;

  const completedAt =
    observation.completedAt ??
    (completionState === "complete" ? (existing?.completedAt ?? null) : null);

  return {
    completed_at: completedAt,
    completion_state: completionState,
    enrollment_status: observation.enrollmentStatus,
    first_enrolled_at:
      existing?.firstEnrolledAt ?? observation.firstEnrolledAt ?? observedAt,
    last_access_at: observation.lastAccessAt,
    last_seen_at: observedAt,
    last_synced_at: observedAt,
    moodle_course_id: observation.moodleCourseId,
    moodle_user_id: observation.moodleUserId,
    progress_percentage: observation.progressPercentage,
    role_shortname: observation.roleShortname,
    updated_at: observedAt,
  };
}
