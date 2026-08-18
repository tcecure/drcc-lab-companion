"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireManager } from "@/lib/auth";
import { runCohortAssignment } from "@/lib/cohort-runner";
import {
  formatCohortStartDate,
  getCohortNumberForStartDate,
  getCohortSchedule,
  getNextCohortNumber,
  queueUserForCohort,
} from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import {
  processQueuedEmails,
  queueEmail,
  renderQueueConfirmation,
} from "@/lib/notifications";
import {
  cleanEmail,
  parseParticipantCsv,
  type StudentRow,
} from "@/lib/participants";
import { createAdminClient } from "@/lib/supabase/admin";

type ImportResult = {
  queued: number;
  alreadyQueued: number;
};

function message(input: string) {
  return encodeURIComponent(input);
}

function parseManual(formData: FormData): StudentRow[] {
  const rows: StudentRow[] = [];

  for (let index = 0; index < 10; index += 1) {
    const fullName = String(formData.get(`student-${index}-name`) ?? "").trim();
    const email = cleanEmail(
      String(formData.get(`student-${index}-email`) ?? ""),
    );

    if (fullName || email) {
      if (!fullName || !email) {
        throw new Error("Every manual row needs both a name and email.");
      }

      rows.push({ fullName, email, labStartDate: null });
    }
  }

  return rows;
}

function readSelectedCohort(formData: FormData) {
  const raw = String(formData.get("cohortNumber") ?? "").trim();

  if (!raw || raw === "auto") {
    return null;
  }

  const cohortNumber = Number(raw);

  if (!Number.isInteger(cohortNumber) || cohortNumber < 1) {
    throw new Error("Select a valid cohort.");
  }

  return cohortNumber;
}

function resolveCohortNumber(row: StudentRow, selected: number | null) {
  if (selected) {
    return selected;
  }

  const fromRow = row.labStartDate
    ? getCohortNumberForStartDate(row.labStartDate)
    : null;
  const cohortNumber = fromRow ?? getNextCohortNumber();

  if (!cohortNumber) {
    throw new Error("No cohort remains on the calendar for these students.");
  }

  return cohortNumber;
}

async function importRows(
  rows: StudentRow[],
  actorId: string,
  source: "csv_import" | "manual_entry",
  selectedCohort: number | null,
): Promise<ImportResult> {
  const env = readServerEnv();
  const supabase = createAdminClient();
  const { data: studentRole } = await supabase
    .from("roles")
    .select("id")
    .eq("role_name", "student")
    .single();

  if (!studentRole) {
    throw new Error("Student role is missing in Supabase.");
  }

  const result: ImportResult = { queued: 0, alreadyQueued: 0 };

  for (const row of rows) {
    const cohortNumber = resolveCohortNumber(row, selectedCohort);
    const schedule = getCohortSchedule(cohortNumber);
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", row.email)
      .maybeSingle();
    let userId = profile?.id ?? null;

    if (!userId) {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(
        row.email,
        {
          data: { full_name: row.fullName, organization: "DigitalRCC Student" },
          redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        },
      );

      if (error) {
        throw new Error(`${row.email}: ${error.message}`);
      }

      userId = data.user?.id ?? null;
    }

    if (!userId) {
      throw new Error(`${row.email}: Supabase did not return a user id.`);
    }

    await supabase.from("profiles").upsert({
      id: userId,
      email: row.email,
      full_name: row.fullName,
      organization: "DigitalRCC Student",
      account_status: "active",
    });
    await supabase
      .from("user_roles")
      .upsert(
        { user_id: userId, role_id: studentRole.id, assigned_by: actorId },
        { onConflict: "user_id,role_id" },
      );

    const { alreadyQueued } = await queueUserForCohort(
      userId,
      cohortNumber,
      actorId,
      source,
    );

    if (alreadyQueued) {
      result.alreadyQueued += 1;
      continue;
    }

    const labStartDate = formatCohortStartDate(schedule.startDate);

    await queueEmail({
      userId,
      recipient: row.email,
      templateName: "student_lab_queue_confirmation",
      content: renderQueueConfirmation({
        fullName: row.fullName,
        labStartDate,
        portalUrl: env.NEXT_PUBLIC_APP_URL,
      }),
      payload: {
        cohortNumber,
        labStartDate,
        accessStartsAt: schedule.accessStartsAt,
        accessEndsAt: schedule.accessEndsAt,
        actionUrl: `${env.NEXT_PUBLIC_APP_URL}/student/queue`,
      },
    });
    result.queued += 1;
  }

  await processQueuedEmails();

  return result;
}

function summarize(result: ImportResult) {
  const parts = [`Queued ${result.queued} students`];

  if (result.alreadyQueued) {
    parts.push(`${result.alreadyQueued} already had a queue entry`);
  }

  return `${parts.join(", ")}. Student numbers are assigned at 1:00 AM Eastern on the cohort start date.`;
}

export async function importCsvAction(formData: FormData) {
  const { user } = await requireManager();
  const file = formData.get("csvFile");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/import?error=${message("Upload a CSV file.")}`);
  }

  let result: ImportResult;

  try {
    const rows = parseParticipantCsv(await file.text());

    if (rows.length === 0) {
      throw new Error("No participant rows with a name and email were found.");
    }

    result = await importRows(
      rows,
      user.id,
      "csv_import",
      readSelectedCohort(formData),
    );
  } catch (error) {
    redirect(
      `/admin/import?error=${message(error instanceof Error ? error.message : "Import failed.")}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  redirect(`/admin/import?message=${message(summarize(result))}`);
}

export async function importManualAction(formData: FormData) {
  const { user } = await requireManager();
  let result: ImportResult;

  try {
    const rows = parseManual(formData);

    if (rows.length === 0) {
      throw new Error("Add at least one student.");
    }

    result = await importRows(
      rows,
      user.id,
      "manual_entry",
      readSelectedCohort(formData),
    );
  } catch (error) {
    redirect(
      `/admin/import?error=${message(error instanceof Error ? error.message : "Import failed.")}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  redirect(`/admin/import?message=${message(summarize(result))}`);
}

/** Runs the scheduled student-number assignment on demand from the admin queue. */
export async function runCohortAssignmentAction() {
  await requireManager();

  let assignedCount = 0;

  try {
    const result = await runCohortAssignment();

    assignedCount = result.assigned;
  } catch (error) {
    redirect(
      `/admin/queue?error=${message(error instanceof Error ? error.message : "Assignment run failed.")}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  redirect(
    `/admin/queue?message=${message(`Assigned ${assignedCount} student numbers.`)}`,
  );
}
