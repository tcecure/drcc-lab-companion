"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManager } from "@/lib/auth";
import { cohortConfig } from "@/lib/cohorts";
import {
  createCohortFileUploadTicket,
  deleteCohortFile,
  isCohortFileFolder,
  registerCohortFile,
} from "@/lib/cohort-files";
import type { CohortFileFolder } from "@/lib/cohort-files-public";

const targetSchema = z.object({
  cohortNumber: z.coerce
    .number()
    .int()
    .min(1)
    .max(cohortConfig.lastCohortNumber),
  folder: z.string().refine(isCohortFileFolder, "Unknown folder."),
});

const ticketSchema = targetSchema.extend({
  fileName: z.string().trim().min(1).max(255),
});

const registerSchema = targetSchema.extend({
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  description: z.string().trim().max(500).optional(),
  fileId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  storagePath: z.string().min(1),
  studentUserId: z.string().uuid().optional().or(z.literal("")),
});

export type CohortFileUploadTicket = {
  fileId: string;
  fileName: string;
  storagePath: string;
  token: string;
};

export type CohortFileActionResult<T> =
  { ok: true; value: T } | { error: string; ok: false };

function failure(error: unknown): { error: string; ok: false } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Something went wrong.",
  };
}

/**
 * Step one of an upload: the browser asks for a ticket and then sends the
 * bytes straight to storage. The file never passes through this action, which
 * is what lets a 50 MB export work — a serverless request body is capped far
 * below that.
 */
export async function prepareCohortFileUploadAction(input: {
  cohortNumber: number;
  fileName: string;
  folder: string;
}): Promise<CohortFileActionResult<CohortFileUploadTicket>> {
  const { user: actor } = await requireManager();
  const parsed = ticketSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "That upload is missing a cohort or folder." };
  }

  try {
    return {
      ok: true,
      value: await createCohortFileUploadTicket(
        {
          cohortNumber: parsed.data.cohortNumber,
          fileName: parsed.data.fileName,
          folder: parsed.data.folder as CohortFileFolder,
        },
        { role: "staff", userId: actor.id },
      ),
    };
  } catch (error) {
    return failure(error);
  }
}

/** Step two: record the object the browser just stored. */
export async function registerCohortFileAction(input: {
  checksumSha256?: string;
  cohortNumber: number;
  description?: string;
  fileId: string;
  fileName: string;
  folder: string;
  storagePath: string;
  studentUserId?: string;
}): Promise<CohortFileActionResult<{ fileName: string }>> {
  const { user: actor } = await requireManager();
  const parsed = registerSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "That upload could not be recorded." };
  }

  try {
    const row = await registerCohortFile(
      {
        checksumSha256: parsed.data.checksumSha256 ?? null,
        cohortNumber: parsed.data.cohortNumber,
        description: parsed.data.description || null,
        fileId: parsed.data.fileId,
        fileName: parsed.data.fileName,
        folder: parsed.data.folder as CohortFileFolder,
        storagePath: parsed.data.storagePath,
        studentUserId: parsed.data.studentUserId || null,
      },
      { role: "staff", userId: actor.id },
    );

    revalidatePath(`/admin/files/${row.cohort_number}/${row.folder}`);
    revalidatePath(`/admin/files/${row.cohort_number}`);
    revalidatePath("/admin/files");
    revalidatePath("/student/documents");

    return { ok: true, value: { fileName: row.file_name } };
  } catch (error) {
    return failure(error);
  }
}

const deleteSchema = z.object({ fileId: z.string().uuid() });

function message(input: string) {
  return encodeURIComponent(input);
}

export async function deleteCohortFileAction(formData: FormData) {
  const { user: actor } = await requireManager();
  const parsed = deleteSchema.safeParse({ fileId: formData.get("fileId") });

  if (!parsed.success) {
    redirect(
      `/admin/files?error=${message("That file reference is not valid.")}`,
    );
  }

  const removed = await deleteCohortFile(parsed.data.fileId, {
    role: "staff",
    userId: actor.id,
  });

  if (!removed) {
    redirect(`/admin/files?error=${message("That file is already gone.")}`);
  }

  const target = `/admin/files/${removed.cohort_number}/${removed.folder}`;
  revalidatePath(target);
  revalidatePath("/admin/files");
  redirect(`${target}?notice=${message(`${removed.file_name} removed.`)}`);
}
