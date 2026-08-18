import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const cohortConfig = {
  timeZone: "America/New_York",
  /** Cohort 1 opened Sunday, August 16, 2026. */
  firstCohortStartDate: "2026-08-16",
  /** Cohort 2 opens Sunday, September 6, 2026 after the one-week feedback break. */
  secondCohortStartDate: "2026-09-06",
  /** Cohorts run every two weeks from cohort 2 onward. */
  cadenceDays: 14,
  accessWindowDays: 14,
  seatsPerCohort: 20,
  /** Student numbers are assigned at 01:00 local time on the cohort start date. */
  assignmentHour: 1,
  lastCohortNumber: 24,
};

export type CohortSchedule = {
  cohortNumber: number;
  startDate: string;
  accessStartsAt: string;
  accessEndsAt: string;
  assignmentRunAt: string;
};

const dayMs = 86400000;

function parseDate(dateIso: string) {
  const [year, month, day] = dateIso.split("-").map(Number);

  return Date.UTC(year, month - 1, day);
}

function formatDateIso(utcMidnight: number) {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

function zoneOffsetMinutes(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cohortConfig.timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const lookup = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour") % 24,
    lookup("minute"),
    lookup("second"),
  );

  return (asUtc - instant.getTime()) / 60000;
}

/** Converts a local wall-clock time in the cohort time zone into a UTC instant. */
function zonedTimeToUtc(dateIso: string, hour: number) {
  const naive = parseDate(dateIso) + hour * 3600000;
  const firstPass = naive - zoneOffsetMinutes(new Date(naive)) * 60000;

  return new Date(naive - zoneOffsetMinutes(new Date(firstPass)) * 60000);
}

export function getCohortStartDate(cohortNumber: number) {
  if (cohortNumber <= 1) {
    return cohortConfig.firstCohortStartDate;
  }

  return formatDateIso(
    parseDate(cohortConfig.secondCohortStartDate) +
      (cohortNumber - 2) * cohortConfig.cadenceDays * dayMs,
  );
}

export function getCohortSchedule(cohortNumber: number): CohortSchedule {
  const startDate = getCohortStartDate(cohortNumber);
  const accessStartsAt = zonedTimeToUtc(startDate, 0);
  const accessEndsAt = zonedTimeToUtc(
    formatDateIso(parseDate(startDate) + cohortConfig.accessWindowDays * dayMs),
    0,
  );

  return {
    cohortNumber,
    startDate,
    accessStartsAt: accessStartsAt.toISOString(),
    accessEndsAt: accessEndsAt.toISOString(),
    assignmentRunAt: zonedTimeToUtc(
      startDate,
      cohortConfig.assignmentHour,
    ).toISOString(),
  };
}

/** The first cohort that has not started yet, relative to `now`. */
export function getNextCohortNumber(now = new Date()) {
  for (
    let cohortNumber = 1;
    cohortNumber <= cohortConfig.lastCohortNumber;
    cohortNumber += 1
  ) {
    if (new Date(getCohortSchedule(cohortNumber).accessStartsAt) > now) {
      return cohortNumber;
    }
  }

  return null;
}

/** The cohort whose access window contains `now`. */
export function getCurrentCohortNumber(now = new Date()) {
  for (
    let cohortNumber = 1;
    cohortNumber <= cohortConfig.lastCohortNumber;
    cohortNumber += 1
  ) {
    const schedule = getCohortSchedule(cohortNumber);

    if (
      new Date(schedule.accessStartsAt) <= now &&
      now < new Date(schedule.accessEndsAt)
    ) {
      return cohortNumber;
    }
  }

  return null;
}

/** The cohort a lab start date (e.g. the registration form date) belongs to. */
export function getCohortNumberForStartDate(dateIso: string) {
  for (
    let cohortNumber = 1;
    cohortNumber <= cohortConfig.lastCohortNumber;
    cohortNumber += 1
  ) {
    if (getCohortStartDate(cohortNumber) >= dateIso) {
      return cohortNumber;
    }
  }

  return null;
}

export function listCohortOptions(now = new Date(), count = 8) {
  const first = getNextCohortNumber(now) ?? cohortConfig.lastCohortNumber;

  return Array.from({ length: count }, (_, index) => first + index)
    .filter((cohortNumber) => cohortNumber <= cohortConfig.lastCohortNumber)
    .map(getCohortSchedule);
}

export function getPodName(seatNumber: number) {
  return `Pod${String(seatNumber).padStart(2, "0")}`;
}

export function getLabIdentity(seatNumber: number) {
  const suffix = String(seatNumber).padStart(2, "0");

  return {
    labUsername: `student${suffix}`,
    podName: getPodName(seatNumber),
  };
}

export function getFirstAvailableSeat(occupiedSeats: Iterable<number | null>) {
  const occupied = new Set(
    [...occupiedSeats].filter(
      (seat): seat is number =>
        typeof seat === "number" &&
        seat >= 1 &&
        seat <= cohortConfig.seatsPerCohort,
    ),
  );

  for (let seat = 1; seat <= cohortConfig.seatsPerCohort; seat += 1) {
    if (!occupied.has(seat)) {
      return seat;
    }
  }

  return null;
}

export function formatCohortStartDate(startDate: string) {
  return new Date(zonedTimeToUtc(startDate, 12)).toLocaleDateString("en-US", {
    timeZone: cohortConfig.timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Places a student in the queue for a cohort without assigning a student
 * number. Seats are handed out by `assignDueCohortSeats` at 01:00 local time on
 * the cohort start date.
 */
export async function queueUserForCohort(
  userId: string,
  cohortNumber: number,
  actorId: string,
  source = "manual_entry",
) {
  const supabase = createAdminClient();
  // student_cohort_assignments is unique on user_id, so a cancelled row has to
  // be re-queued in place rather than inserted alongside.
  const { data: existing } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing && existing.status !== "cancelled") {
    return { assignment: existing, alreadyQueued: true };
  }

  if (cohortNumber > cohortConfig.lastCohortNumber) {
    throw new Error("The cohort calendar does not reach that far ahead.");
  }

  const schedule = getCohortSchedule(cohortNumber);
  const values = {
    source,
    cohort_number: schedule.cohortNumber,
    seat_number: null,
    lab_username: null,
    pod_name: null,
    access_starts_at: schedule.accessStartsAt,
    access_ends_at: schedule.accessEndsAt,
    notification_send_at: schedule.assignmentRunAt,
    status: "queued" as const,
    credential_status: "pending_rotation" as const,
    credential_version: 0,
    created_by: actorId,
  };
  const { data, error } = existing
    ? await supabase
        .from("student_cohort_assignments")
        .update({ ...values, notified_at: null })
        .eq("id", existing.id)
        .select("*")
        .single()
    : await supabase
        .from("student_cohort_assignments")
        .insert({ ...values, user_id: userId })
        .select("*")
        .single();

  if (error) {
    throw new Error(error.message);
  }

  return { assignment: data, alreadyQueued: false };
}

/**
 * Adds a current student directly to the active cohort without entering the
 * notification workflow. Used only by the explicit silent testing import.
 */
export async function activateUserForCurrentCohort(
  userId: string,
  actorId: string,
  now = new Date(),
) {
  const cohortNumber = getCurrentCohortNumber(now);

  if (!cohortNumber) {
    throw new Error("There is no active cohort window right now.");
  }

  const supabase = createAdminClient();
  const schedule = getCohortSchedule(cohortNumber);
  const { data: existing, error: existingError } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (
    existing?.cohort_number === cohortNumber &&
    existing.seat_number !== null &&
    existing.status === "active"
  ) {
    return { assignment: existing, alreadyActive: true };
  }

  let seatNumber =
    existing?.cohort_number === cohortNumber && existing.status !== "cancelled"
      ? existing.seat_number
      : null;

  if (seatNumber === null) {
    const { data: occupied, error: occupiedError } = await supabase
      .from("student_cohort_assignments")
      .select("seat_number")
      .eq("cohort_number", cohortNumber)
      .neq("status", "cancelled")
      .not("seat_number", "is", null);

    if (occupiedError) {
      throw new Error(occupiedError.message);
    }

    seatNumber = getFirstAvailableSeat(
      (occupied ?? []).map((row) => row.seat_number),
    );
  }

  if (seatNumber === null) {
    throw new Error(`Cohort ${cohortNumber} has no free student numbers.`);
  }

  const identity = getLabIdentity(seatNumber);
  const sameCohort = existing?.cohort_number === cohortNumber;
  const values = {
    source: "silent_active_import",
    cohort_number: cohortNumber,
    seat_number: seatNumber,
    lab_username: identity.labUsername,
    pod_name: identity.podName,
    access_starts_at:
      sameCohort && existing
        ? existing.access_starts_at
        : schedule.accessStartsAt,
    access_ends_at:
      sameCohort && existing ? existing.access_ends_at : schedule.accessEndsAt,
    notification_send_at: schedule.assignmentRunAt,
    status: "active" as const,
    credential_status: existing?.credential_status ?? "pending_rotation",
    credential_version: existing?.credential_version ?? 0,
    notified_at: null,
    created_by: actorId,
  };
  const { data, error } = existing
    ? await supabase
        .from("student_cohort_assignments")
        .update(values)
        .eq("id", existing.id)
        .select("*")
        .single()
    : await supabase
        .from("student_cohort_assignments")
        .insert({ ...values, user_id: userId })
        .select("*")
        .single();

  if (error) {
    throw new Error(error.message);
  }

  return { assignment: data, alreadyActive: false };
}

/**
 * Hands out student numbers for every cohort whose 01:00 assignment time has
 * passed, in queue order. Safe to run repeatedly.
 */
export async function assignDueCohortSeats(now = new Date()) {
  const supabase = createAdminClient();
  const { data: pending, error } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .is("seat_number", null)
    .eq("status", "queued")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const assigned: {
    id: string;
    userId: string;
    cohortNumber: number;
    seatNumber: number;
    labUsername: string;
    podName: string;
    accessStartsAt: string;
    accessEndsAt: string;
  }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const takenSeats = new Map<number, Set<number>>();

  for (const row of pending ?? []) {
    const schedule = getCohortSchedule(row.cohort_number);

    if (new Date(schedule.assignmentRunAt) > now) {
      continue;
    }

    if (!takenSeats.has(row.cohort_number)) {
      const { data: occupied } = await supabase
        .from("student_cohort_assignments")
        .select("seat_number")
        .eq("cohort_number", row.cohort_number)
        .neq("status", "cancelled")
        .not("seat_number", "is", null);

      takenSeats.set(
        row.cohort_number,
        new Set(
          (occupied ?? [])
            .map((seat) => seat.seat_number)
            .filter((seat): seat is number => typeof seat === "number"),
        ),
      );
    }

    const taken = takenSeats.get(row.cohort_number)!;
    let seatNumber: number | null = null;

    for (let seat = 1; seat <= cohortConfig.seatsPerCohort; seat += 1) {
      if (!taken.has(seat)) {
        seatNumber = seat;
        break;
      }
    }

    if (seatNumber === null) {
      skipped.push({
        id: row.id,
        reason: `Cohort ${row.cohort_number} has no free seat.`,
      });
      continue;
    }

    const identity = getLabIdentity(seatNumber);
    const { error: updateError } = await supabase
      .from("student_cohort_assignments")
      .update({
        seat_number: seatNumber,
        lab_username: identity.labUsername,
        pod_name: identity.podName,
        status: "notified",
        notified_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .is("seat_number", null);

    if (updateError) {
      skipped.push({ id: row.id, reason: updateError.message });
      continue;
    }

    taken.add(seatNumber);
    assigned.push({
      id: row.id,
      userId: row.user_id,
      cohortNumber: row.cohort_number,
      seatNumber,
      labUsername: identity.labUsername,
      podName: identity.podName,
      accessStartsAt: schedule.accessStartsAt,
      accessEndsAt: schedule.accessEndsAt,
    });
  }

  return { assigned, skipped };
}
