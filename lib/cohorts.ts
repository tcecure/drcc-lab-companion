import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const cohortConfig = {
  firstAccessStartIso: "2026-08-17T13:00:00.000Z",
  seatsPerCohort: 20,
  accessWindowDays: 14,
  feedbackBreakDaysAfterFirstCohort: 7,
  notifyHourUtc: 14,
  scheduleUntilIso: "2027-01-01T05:59:59.000Z",
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function cohortOffsetDays(cohortNumber: number) {
  if (cohortNumber <= 1) {
    return 0;
  }

  return (
    cohortConfig.accessWindowDays +
    cohortConfig.feedbackBreakDaysAfterFirstCohort +
    (cohortNumber - 2) * cohortConfig.accessWindowDays
  );
}

export function getCohortSlot(cohortNumber: number, seatNumber: number) {
  const accessStartsAt = addDays(
    new Date(cohortConfig.firstAccessStartIso),
    cohortOffsetDays(cohortNumber),
  );
  const accessEndsAt = addDays(accessStartsAt, cohortConfig.accessWindowDays);
  const notificationSendAt = new Date(accessStartsAt);
  notificationSendAt.setUTCDate(notificationSendAt.getUTCDate() - 1);
  notificationSendAt.setUTCHours(cohortConfig.notifyHourUtc, 0, 0, 0);

  return {
    cohortNumber,
    seatNumber,
    accessStartsAt: accessStartsAt.toISOString(),
    accessEndsAt: accessEndsAt.toISOString(),
    notificationSendAt: notificationSendAt.toISOString(),
  };
}

export function getPodName(seatNumber: number) {
  return `student${String(seatNumber).padStart(2, "0")}`;
}

export async function assignUserToNextCohort(
  userId: string,
  actorId: string,
  source = "manual_entry",
) {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: assignments } = await supabase
    .from("student_cohort_assignments")
    .select("cohort_number, seat_number, status")
    .neq("status", "cancelled");
  const occupied = new Set(
    (assignments ?? []).map((row) => `${row.cohort_number}:${row.seat_number}`),
  );

  for (let cohortNumber = 1; cohortNumber <= 12; cohortNumber += 1) {
    for (
      let seatNumber = 1;
      seatNumber <= cohortConfig.seatsPerCohort;
      seatNumber += 1
    ) {
      if (!occupied.has(`${cohortNumber}:${seatNumber}`)) {
        const slot = getCohortSlot(cohortNumber, seatNumber);

        if (
          new Date(slot.accessStartsAt) >
          new Date(cohortConfig.scheduleUntilIso)
        ) {
          throw new Error(
            "The cohort calendar is full through the end of the year.",
          );
        }

        const { data, error } = await supabase
          .from("student_cohort_assignments")
          .insert({
            user_id: userId,
            source: source as "csv_import" | "manual_entry" | "access_request",
            cohort_number: slot.cohortNumber,
            seat_number: slot.seatNumber,
            pod_name: getPodName(slot.seatNumber),
            access_starts_at: slot.accessStartsAt,
            access_ends_at: slot.accessEndsAt,
            notification_send_at: slot.notificationSendAt,
            status: "queued",
            created_by: actorId,
          })
          .select("*")
          .single();

        if (error) {
          throw new Error(error.message);
        }

        return data;
      }
    }
  }

  throw new Error("No cohort seats remain.");
}
