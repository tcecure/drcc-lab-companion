"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManager } from "@/lib/auth";
import { cohortConfig } from "@/lib/cohorts";
import {
  deleteCohortFile,
  isCohortFileFolder,
  uploadCohortFile,
} from "@/lib/cohort-files";

/**
 * Transcripts and evidence exports are documents, not media: 50 MB is far
 * above anything the generator produces and still small enough that a mistaken
 * upload cannot fill the bucket.
 */
const maxUploadBytes = 50 * 1024 * 1024;

const uploadSchema = z.object({
  cohortNumber: z.coerce
    .number()
    .int()
    .min(1)
    .max(cohortConfig.lastCohortNumber),
  folder: z.string().refine(isCohortFileFolder, "Unknown folder."),
  description: z.string().trim().max(500).optional(),
  studentUserId: z.string().uuid().optional().or(z.literal("")),
});

function message(input: string) {
  return encodeURIComponent(input);
}

export async function uploadCohortFileAction(formData: FormData) {
  const { user: actor } = await requireManager();
  const parsed = uploadSchema.safeParse({
    cohortNumber: formData.get("cohortNumber"),
    folder: formData.get("folder"),
    description: formData.get("description") ?? undefined,
    studentUserId: formData.get("studentUserId") ?? undefined,
  });

  if (!parsed.success) {
    redirect(
      `/admin/files?error=${message("That upload is missing a cohort or folder.")}`,
    );
  }

  const { cohortNumber, folder } = parsed.data;
  const target = `/admin/files/${cohortNumber}/${folder}`;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`${target}?error=${message("Choose a file to upload.")}`);
  }

  if (file.size > maxUploadBytes) {
    redirect(
      `${target}?error=${message("That file is larger than the 50 MB limit.")}`,
    );
  }

  try {
    await uploadCohortFile(
      {
        body: Buffer.from(await file.arrayBuffer()),
        cohortNumber,
        contentType: file.type || undefined,
        description: parsed.data.description || null,
        fileName: file.name,
        folder: folder as "transcripts" | "evidence" | "reports",
        studentUserId: parsed.data.studentUserId || null,
      },
      { role: "staff", userId: actor.id },
    );
  } catch (error) {
    redirect(
      `${target}?error=${message(
        error instanceof Error ? error.message : "Upload failed.",
      )}`,
    );
  }

  revalidatePath(target);
  revalidatePath("/admin/files");
  redirect(`${target}?notice=${message(`${file.name} uploaded.`)}`);
}

const deleteSchema = z.object({ fileId: z.string().uuid() });

export async function deleteCohortFileAction(formData: FormData) {
  const { user: actor } = await requireManager();
  const parsed = deleteSchema.safeParse({ fileId: formData.get("fileId") });

  if (!parsed.success) {
    redirect(`/admin/files?error=${message("That file reference is not valid.")}`);
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
