"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireManager } from "@/lib/auth";
import { assignUserToNextCohort } from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

type StudentRow = {
  fullName: string;
  email: string;
};

function message(input: string) {
  return encodeURIComponent(input);
}

function cleanEmail(input: string) {
  return input.trim().toLowerCase();
}

function parseCsv(text: string): StudentRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const header =
    lines
      .shift()
      ?.split(",")
      .map((item) => item.trim().toLowerCase()) ?? [];
  const firstNameIndex = header.findIndex((name) =>
    ["first name", "firstname", "first"].includes(name),
  );
  const lastNameIndex = header.findIndex((name) =>
    ["last name", "lastname", "last"].includes(name),
  );
  const nameIndex = header.findIndex((name) =>
    ["name", "full name", "fullname", "participant name"].includes(name),
  );
  const emailIndex = header.findIndex((name) =>
    ["email", "email address", "participant email"].includes(name),
  );

  if (emailIndex < 0 || (nameIndex < 0 && firstNameIndex < 0)) {
    throw new Error(
      "CSV needs email plus either name or first/last name columns.",
    );
  }

  return lines
    .map((line) =>
      line.split(",").map((item) => item.trim().replace(/^"|"$/g, "")),
    )
    .map((cols) => ({
      email: cleanEmail(cols[emailIndex] ?? ""),
      fullName:
        nameIndex >= 0
          ? (cols[nameIndex] ?? "")
          : `${cols[firstNameIndex] ?? ""} ${cols[lastNameIndex] ?? ""}`.trim(),
    }))
    .filter((row) => row.email && row.fullName);
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

      rows.push({ fullName, email });
    }
  }

  return rows;
}

async function importRows(
  rows: StudentRow[],
  actorId: string,
  source: "csv_import" | "manual_entry",
) {
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

  let imported = 0;

  for (const row of rows) {
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
    const cohort = await assignUserToNextCohort(userId, actorId, source);
    await supabase.from("email_jobs").insert({
      user_id: userId,
      template_name: "student_portal_invite",
      recipient: row.email,
      subject: "DigitalRCC lab access details",
      payload: {
        actionUrl: `${env.NEXT_PUBLIC_APP_URL}/login`,
        cohortNumber: cohort.cohort_number,
        podName: cohort.pod_name,
        seatNumber: cohort.seat_number,
        accessStartsAt: cohort.access_starts_at,
        accessEndsAt: cohort.access_ends_at,
      },
      rendered_text: `Your DigitalRCC lab access is scheduled for cohort ${cohort.cohort_number}, ${cohort.pod_name}.`,
      status: "queued",
    });
    imported += 1;
  }

  return imported;
}

export async function importCsvAction(formData: FormData) {
  const { user } = await requireManager();
  const file = formData.get("csvFile");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/import?error=${message("Upload a CSV file.")}`);
  }

  try {
    const count = await importRows(
      parseCsv(await file.text()),
      user.id,
      "csv_import",
    );
    revalidatePath("/admin");
    redirect(`/admin/import?message=${message(`Imported ${count} students.`)}`);
  } catch (error) {
    redirect(
      `/admin/import?error=${message(error instanceof Error ? error.message : "Import failed.")}`,
    );
  }
}

export async function importManualAction(formData: FormData) {
  const { user } = await requireManager();

  try {
    const rows = parseManual(formData);

    if (rows.length === 0) {
      throw new Error("Add at least one student.");
    }

    const count = await importRows(rows, user.id, "manual_entry");
    revalidatePath("/admin");
    redirect(`/admin/import?message=${message(`Imported ${count} students.`)}`);
  } catch (error) {
    redirect(
      `/admin/import?error=${message(error instanceof Error ? error.message : "Import failed.")}`,
    );
  }
}
