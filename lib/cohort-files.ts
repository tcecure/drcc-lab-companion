import "server-only";

import { createHash } from "node:crypto";

import { cohortConfig, getCohortSchedule } from "@/lib/cohorts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";

export type CohortFileRow = Database["public"]["Tables"]["cohort_files"]["Row"];

export type CohortFileFolder = CohortFileRow["folder"];

export type CohortFileActor = {
  role: "student" | "staff" | "integration";
  userId?: string | null;
};

export type CohortFileEntry = {
  byteSize: number;
  contentType: string;
  createdAt: string;
  description: string | null;
  fileName: string;
  folder: CohortFileFolder;
  id: string;
  ownerName: string | null;
  studentUserId: string | null;
  uploadedByName: string | null;
};

export type CohortFolderSummary = {
  fileCount: number;
  folder: CohortFileFolder;
  label: string;
  lastUpdatedAt: string | null;
  totalBytes: number;
};

export type CohortRepositorySummary = {
  cohortNumber: number;
  fileCount: number;
  lastUpdatedAt: string | null;
  startDate: string;
  totalBytes: number;
};

export const bucketId = "cohort-files";

export const cohortFileFolders: {
  description: string;
  folder: CohortFileFolder;
  label: string;
}[] = [
  {
    folder: "transcripts",
    label: "Transcripts",
    description:
      "Learning reports issued to individual students. Each one is visible to the student it belongs to.",
  },
  {
    folder: "evidence",
    label: "Lab Evidence",
    description:
      "Exports of the artifacts a student produced in their pod, kept with the cohort they belong to.",
  },
  {
    folder: "reports",
    label: "Cohort Reports",
    description:
      "Staff-facing documents about the cohort as a whole: rosters, summaries, funder reporting.",
  },
];

export function folderLabel(folder: CohortFileFolder) {
  return (
    cohortFileFolders.find((entry) => entry.folder === folder)?.label ?? folder
  );
}

export function isCohortFileFolder(value: string): value is CohortFileFolder {
  return cohortFileFolders.some((entry) => entry.folder === value);
}

/**
 * A file name safe to use as an object key and as a Content-Disposition value.
 * Path separators are the real hazard: `../` in an uploaded name would
 * otherwise escape the cohort prefix inside the bucket.
 */
export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 160);

  return cleaned.length > 0 ? cleaned : "file";
}

export function cohortFolderName(cohortNumber: number) {
  return `cohort-${String(cohortNumber).padStart(2, "0")}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function assertCohortNumber(cohortNumber: number) {
  if (
    !Number.isInteger(cohortNumber) ||
    cohortNumber < 1 ||
    cohortNumber > cohortConfig.lastCohortNumber
  ) {
    throw new Error(`Cohort ${cohortNumber} is not on the cohort calendar.`);
  }
}

async function resolveNames(userIds: (string | null)[]) {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => Boolean(id))),
  );

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  return new Map(
    (data ?? []).map((row) => [row.id, row.full_name || row.email]),
  );
}

async function recordEvent(
  cohortNumber: number,
  fileId: string | null,
  action: "upload" | "download" | "delete",
  actor: CohortFileActor,
  detail?: string,
) {
  const supabase = createAdminClient();
  await supabase.from("cohort_file_events").insert({
    action,
    cohort_number: cohortNumber,
    detail: detail ?? null,
    file_id: fileId,
    actor_role: actor.role,
    actor_user_id: actor.userId ?? null,
  });
}

function toEntry(
  row: CohortFileRow,
  names: Map<string, string>,
): CohortFileEntry {
  return {
    byteSize: Number(row.byte_size),
    contentType: row.content_type,
    createdAt: row.created_at,
    description: row.description,
    fileName: row.file_name,
    folder: row.folder,
    id: row.id,
    ownerName: row.student_user_id
      ? (names.get(row.student_user_id) ?? null)
      : null,
    studentUserId: row.student_user_id,
    uploadedByName: row.uploaded_by ? (names.get(row.uploaded_by) ?? null) : null,
  };
}

/** Every cohort that has at least one live file, newest activity first. */
export async function listCohortRepositories(): Promise<
  CohortRepositorySummary[]
> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cohort_files")
    .select("cohort_number, byte_size, created_at")
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  const summaries = new Map<number, CohortRepositorySummary>();

  for (const row of data ?? []) {
    const existing = summaries.get(row.cohort_number) ?? {
      cohortNumber: row.cohort_number,
      fileCount: 0,
      lastUpdatedAt: null,
      startDate: getCohortSchedule(row.cohort_number).startDate,
      totalBytes: 0,
    };

    existing.fileCount += 1;
    existing.totalBytes += Number(row.byte_size);

    if (!existing.lastUpdatedAt || row.created_at > existing.lastUpdatedAt) {
      existing.lastUpdatedAt = row.created_at;
    }

    summaries.set(row.cohort_number, existing);
  }

  return Array.from(summaries.values()).sort(
    (a, b) => b.cohortNumber - a.cohortNumber,
  );
}

export async function listCohortFolders(
  cohortNumber: number,
): Promise<CohortFolderSummary[]> {
  assertCohortNumber(cohortNumber);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cohort_files")
    .select("folder, byte_size, created_at")
    .eq("cohort_number", cohortNumber)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return cohortFileFolders.map(({ folder, label }) => {
    const rows = (data ?? []).filter((row) => row.folder === folder);

    return {
      folder,
      label,
      fileCount: rows.length,
      lastUpdatedAt: rows.reduce<string | null>(
        (latest, row) =>
          !latest || row.created_at > latest ? row.created_at : latest,
        null,
      ),
      totalBytes: rows.reduce((total, row) => total + Number(row.byte_size), 0),
    };
  });
}

export async function listCohortFiles(
  cohortNumber: number,
  folder?: CohortFileFolder,
): Promise<CohortFileEntry[]> {
  assertCohortNumber(cohortNumber);

  const supabase = createAdminClient();
  let query = supabase
    .from("cohort_files")
    .select("*")
    .eq("cohort_number", cohortNumber)
    .is("deleted_at", null);

  if (folder) {
    query = query.eq("folder", folder);
  }

  const { data, error } = await query.order("file_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CohortFileRow[];
  const names = await resolveNames(
    rows.flatMap((row) => [row.student_user_id, row.uploaded_by]),
  );

  return rows.map((row) => toEntry(row, names));
}

/** The documents a student may see: those filed against their own user. */
export async function listStudentFiles(
  userId: string,
): Promise<CohortFileEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cohort_files")
    .select("*")
    .eq("student_user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CohortFileRow[];

  return rows.map((row) => toEntry(row, new Map()));
}

export type UploadCohortFileInput = {
  body: Buffer;
  cohortNumber: number;
  contentType?: string;
  description?: string | null;
  fileName: string;
  folder: CohortFileFolder;
  studentUserId?: string | null;
};

/**
 * Stores the bytes and the metadata row. An upload that reuses a live name
 * replaces it: the old row is soft-deleted so the folder keeps one current
 * copy while the superseded document stays accountable.
 */
export async function uploadCohortFile(
  input: UploadCohortFileInput,
  actor: CohortFileActor,
) {
  assertCohortNumber(input.cohortNumber);

  if (input.body.length === 0) {
    throw new Error("That file is empty.");
  }

  const fileName = sanitizeFileName(input.fileName);
  const supabase = createAdminClient();
  const id = crypto.randomUUID();
  const storagePath = `${cohortFolderName(input.cohortNumber)}/${input.folder}/${id}-${fileName}`;
  const contentType = input.contentType || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from(bucketId)
    .upload(storagePath, input.body, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: superseded } = await supabase
    .from("cohort_files")
    .select("id")
    .eq("cohort_number", input.cohortNumber)
    .eq("folder", input.folder)
    .eq("file_name", fileName)
    .is("deleted_at", null);

  for (const row of superseded ?? []) {
    await supabase
      .from("cohort_files")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: actor.userId ?? null,
      })
      .eq("id", row.id);
  }

  const { data, error } = await supabase
    .from("cohort_files")
    .insert({
      id,
      byte_size: input.body.length,
      checksum_sha256: createHash("sha256").update(input.body).digest("hex"),
      cohort_number: input.cohortNumber,
      content_type: contentType,
      description: input.description ?? null,
      file_name: fileName,
      folder: input.folder,
      storage_path: storagePath,
      student_user_id: input.studentUserId ?? null,
      uploaded_by: actor.userId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(bucketId).remove([storagePath]);
    throw new Error(error.message);
  }

  await recordEvent(
    input.cohortNumber,
    id,
    "upload",
    actor,
    `${input.folder}/${fileName}`,
  );

  return data as CohortFileRow;
}

export async function getCohortFile(fileId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("cohort_files")
    .select("*")
    .eq("id", fileId)
    .is("deleted_at", null)
    .maybeSingle();

  return (data as CohortFileRow | null) ?? null;
}

/**
 * A short-lived signed URL for one download. The bucket stays private, so a
 * link that leaks stops working within the minute rather than exposing a
 * learner's transcript indefinitely.
 */
export async function createCohortFileDownload(
  fileId: string,
  actor: CohortFileActor,
) {
  const file = await getCohortFile(fileId);

  if (!file) {
    return null;
  }

  if (actor.role === "student" && file.student_user_id !== actor.userId) {
    return null;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucketId)
    .createSignedUrl(file.storage_path, 60, { download: file.file_name });

  if (error || !data) {
    throw new Error(error?.message ?? "Could not prepare that download.");
  }

  await recordEvent(
    file.cohort_number,
    file.id,
    "download",
    actor,
    `${file.folder}/${file.file_name}`,
  );

  return { file, signedUrl: data.signedUrl };
}

export async function deleteCohortFile(fileId: string, actor: CohortFileActor) {
  const file = await getCohortFile(fileId);

  if (!file) {
    return null;
  }

  const supabase = createAdminClient();
  await supabase.storage.from(bucketId).remove([file.storage_path]);
  const { error } = await supabase
    .from("cohort_files")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: actor.userId ?? null,
    })
    .eq("id", file.id);

  if (error) {
    throw new Error(error.message);
  }

  await recordEvent(
    file.cohort_number,
    file.id,
    "delete",
    actor,
    `${file.folder}/${file.file_name}`,
  );

  return file;
}
