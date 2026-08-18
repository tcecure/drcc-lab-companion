import "server-only";

import {
  assignDueCohortSeats,
  formatCohortStartDate,
  getCohortSchedule,
} from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import {
  processQueuedEmails,
  queueEmail,
  renderSeatAssignment,
} from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Assigns student numbers for every cohort whose 01:00 Eastern assignment time
 * has passed and queues each student's access email. Idempotent.
 */
export async function runCohortAssignment(now = new Date()) {
  const env = readServerEnv();
  const supabase = createAdminClient();
  const { assigned, skipped } = await assignDueCohortSeats(now);

  for (const seat of assigned) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", seat.userId)
      .maybeSingle();

    if (!profile?.email) {
      continue;
    }

    const labStartDate = formatCohortStartDate(
      getCohortSchedule(seat.cohortNumber).startDate,
    );

    await queueEmail({
      userId: seat.userId,
      recipient: profile.email,
      templateName: "student_lab_seat_assigned",
      content: renderSeatAssignment({
        fullName: profile.full_name ?? "Student",
        labStartDate,
        labUsername: seat.labUsername,
        podName: seat.podName,
        portalUrl: env.NEXT_PUBLIC_APP_URL,
      }),
      payload: {
        cohortNumber: seat.cohortNumber,
        seatNumber: seat.seatNumber,
        podName: seat.podName,
        labUsername: seat.labUsername,
        labStartDate,
        actionUrl: `${env.NEXT_PUBLIC_APP_URL}/student/start`,
      },
    });
  }

  const delivery = await processQueuedEmails();

  return { assigned: assigned.length, skipped, delivery };
}
