"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireManager } from "@/lib/auth";
import { runCohortAssignment } from "@/lib/cohort-runner";
import {
  activateUserForCurrentCohort,
  cohortConfig,
  formatCohortStartDate,
  getCohortNumberForStartDate,
  getCohortSchedule,
  getCurrentCohortNumber,
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

type ActiveImportResult = {
  activated: number;
  alreadyActive: number;
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

async function findAuthUserId(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );

    if (match) {
      return match.id;
    }

    if (data.users.length < 200) {
      return null;
    }
  }

  return null;
}

async function getStudentRoleId(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await supabase
    .from("roles")
    .select("id")
    .eq("role_name", "student")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Student role is missing in Supabase.");
  }

  return data.id;
}

async function ensureStudentAccount({
  actorId,
  mode,
  redirectTo,
  row,
  studentRoleId,
  supabase,
}: {
  actorId: string;
  mode: "invite" | "silent";
  redirectTo?: string;
  row: StudentRow;
  studentRoleId: string;
  supabase: ReturnType<typeof createAdminClient>;
}) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", row.email)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  let userId = profile?.id ?? null;

  if (!userId) {
    if (mode === "silent") {
      const { data, error } = await supabase.auth.admin.createUser({
        email: row.email,
        email_confirm: true,
        password: randomBytes(32).toString("base64url"),
        user_metadata: {
          full_name: row.fullName,
          organization: "DigitalRCC Student",
          silent_import: true,
        },
      });

      if (error) {
        userId = await findAuthUserId(supabase, row.email);

        if (!userId) {
          throw new Error(`${row.email}: ${error.message}`);
        }
      } else {
        userId = data.user?.id ?? null;
      }
    } else {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(
        row.email,
        {
          data: {
            full_name: row.fullName,
            organization: "DigitalRCC Student",
          },
          redirectTo,
        },
      );

      if (error) {
        userId = await findAuthUserId(supabase, row.email);

        if (!userId) {
          throw new Error(`${row.email}: ${error.message}`);
        }
      } else {
        userId = data.user?.id ?? null;
      }
    }
  }

  if (!userId) {
    throw new Error(`${row.email}: Supabase did not return a user id.`);
  }

  const { error: upsertProfileError } = await supabase.from("profiles").upsert({
    id: userId,
    email: row.email,
    full_name: row.fullName,
    organization: "DigitalRCC Student",
    account_status: "active",
  });

  if (upsertProfileError) {
    throw new Error(`${row.email}: ${upsertProfileError.message}`);
  }

  const { error: roleError } = await supabase
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: studentRoleId, assigned_by: actorId },
      { onConflict: "user_id,role_id" },
    );

  if (roleError) {
    throw new Error(`${row.email}: ${roleError.message}`);
  }

  return userId;
}

async function assertActiveImportCapacity(rows: StudentRow[]) {
  const cohortNumber = getCurrentCohortNumber();

  if (!cohortNumber) {
    throw new Error("There is no active cohort window right now.");
  }

  const supabase = createAdminClient();
  const [{ data: occupied, error: occupiedError }, { data: profiles, error }] =
    await Promise.all([
      supabase
        .from("student_cohort_assignments")
        .select("user_id, seat_number")
        .eq("cohort_number", cohortNumber)
        .neq("status", "cancelled")
        .not("seat_number", "is", null),
      supabase
        .from("profiles")
        .select("id, email")
        .in(
          "email",
          rows.map((row) => row.email),
        ),
    ]);

  if (occupiedError || error) {
    throw new Error(
      occupiedError?.message ?? error?.message ?? "Capacity check failed.",
    );
  }

  const importedUserIds = new Set((profiles ?? []).map((row) => row.id));
  const alreadySeated = (occupied ?? []).filter((row) =>
    importedUserIds.has(row.user_id),
  ).length;
  const occupiedSeats = new Set(
    (occupied ?? [])
      .map((row) => row.seat_number)
      .filter((seat): seat is number => typeof seat === "number"),
  );
  const requiredSeats = rows.length - alreadySeated;
  const availableSeats = cohortConfig.seatsPerCohort - occupiedSeats.size;

  if (requiredSeats > availableSeats) {
    throw new Error(
      `This file needs ${requiredSeats} student numbers, but the active cohort has ${availableSeats} available.`,
    );
  }
}

async function importRows(
  rows: StudentRow[],
  actorId: string,
  source: "csv_import" | "manual_entry",
  selectedCohort: number | null,
): Promise<ImportResult> {
  const env = readServerEnv();
  const supabase = createAdminClient();
  const studentRoleId = await getStudentRoleId(supabase);

  const result: ImportResult = { queued: 0, alreadyQueued: 0 };

  for (const row of rows) {
    const cohortNumber = resolveCohortNumber(row, selectedCohort);
    const schedule = getCohortSchedule(cohortNumber);
    const userId = await ensureStudentAccount({
      actorId,
      mode: "invite",
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      row,
      studentRoleId,
      supabase,
    });

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

async function importActiveRows(
  rows: StudentRow[],
  actorId: string,
): Promise<ActiveImportResult> {
  await assertActiveImportCapacity(rows);

  const supabase = createAdminClient();
  const studentRoleId = await getStudentRoleId(supabase);
  const result: ActiveImportResult = { activated: 0, alreadyActive: 0 };

  for (const row of rows) {
    const userId = await ensureStudentAccount({
      actorId,
      mode: "silent",
      row,
      studentRoleId,
      supabase,
    });
    const { alreadyActive } = await activateUserForCurrentCohort(
      userId,
      actorId,
    );

    if (alreadyActive) {
      result.alreadyActive += 1;
    } else {
      result.activated += 1;
    }
  }

  return result;
}

function summarize(result: ImportResult) {
  const parts = [`Queued ${result.queued} students`];

  if (result.alreadyQueued) {
    parts.push(`${result.alreadyQueued} already had a queue entry`);
  }

  return `${parts.join(", ")}. Student numbers are assigned at 1:00 AM Eastern on the cohort start date.`;
}

function summarizeActive(result: ActiveImportResult) {
  const parts = [`Activated ${result.activated} students without email`];

  if (result.alreadyActive) {
    parts.push(`${result.alreadyActive} were already active`);
  }

  return `${parts.join(", ")}.`;
}

/** Imports current students for operational testing without sending invitations. */
export async function importActiveCsvAction(formData: FormData) {
  const { user } = await requireManager();
  const file = formData.get("csvFile");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/import?error=${message("Upload a CSV file.")}`);
  }

  let result: ActiveImportResult;

  try {
    const rows = parseParticipantCsv(await file.text());

    if (rows.length === 0) {
      throw new Error("No participant rows with a name and email were found.");
    }

    result = await importActiveRows(rows, user.id);
  } catch (error) {
    redirect(
      `/admin/import?error=${message(error instanceof Error ? error.message : "Import failed.")}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  revalidatePath("/student");
  revalidatePath("/student/queue");
  revalidatePath("/student/labs");
  redirect(`/admin/import?message=${message(summarizeActive(result))}`);
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
