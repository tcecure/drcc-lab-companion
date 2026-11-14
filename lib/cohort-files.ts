import "server-only";

import { createHash } from "node:crypto";

import {
  bucketId,
  cohortFileFolders,
  cohortFolderName,
  type CohortFileFolder,
  type CohortFileRow,
  formatBytes,
  maxUploadBytes,
  sanitizeFileName,
} from "@/lib/cohort-files-public";
import { cohortConfig, getCohortSchedule } from "@/lib/cohorts";
import { createAdminClient } from "@/lib/supabase/admin";

export type {
  CohortFileFolder,
  CohortFileRow,
} from "@/lib/cohort-files-public";
export {
  bucketId,
  cohortFileFolders,
  cohortFolderName,
  folderLabel,
  formatBytes,
  isCohortFileFolder,
  isStudentOwnedFolder,
  maxUploadBytes,
  sanitizeFileName,
} from "@/lib/cohort-files-public";

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
    uploadedByName: row.uploaded_by
      ? (names.get(row.uploaded_by) ?? null)
      : null,
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

/**
 * A one-shot ticket the browser uses to put the bytes straight into the
 * bucket. Uploads do not travel through the app: a serverless request body is
 * capped well below the documented limit, so anything but a small PDF would
 * fail in production if the action carried the file itself.
 */
export async function createCohortFileUploadTicket(
  input: {
    cohortNumber: number;
    fileName: string;
    folder: CohortFileFolder;
  },
  actor: CohortFileActor,
) {
  assertCohortNumber(input.cohortNumber);

  const fileName = sanitizeFileName(input.fileName);
  const fileId = crypto.randomUUID();
  const storagePath = `${cohortFolderName(input.cohortNumber)}/${input.folder}/${fileId}-${fileName}`;
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucketId)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(error?.message ?? "Could not start that upload.");
  }

  return {
    fileId,
    fileName,
    storagePath,
    token: data.token,
  };
}

async function readStoredObject(storagePath: string) {
  const separator = storagePath.lastIndexOf("/");
  const supabase = createAdminClient();
  const { data } = await supabase.storage
    .from(bucketId)
    .list(storagePath.slice(0, separator), {
      limit: 1,
      search: storagePath.slice(separator + 1),
    });

  const object = data?.[0];

  if (!object) {
    return null;
  }

  return {
    contentType:
      (object.metadata?.mimetype as string | undefined) ||
      "application/octet-stream",
    size: Number(object.metadata?.size ?? 0),
  };
}

export type RegisterCohortFileInput = {
  checksumSha256?: string | null;
  cohortNumber: number;
  description?: string | null;
  fileId: string;
  fileName: string;
  folder: CohortFileFolder;
  storagePath: string;
  studentUserId?: string | null;
};

/**
 * Records a file the browser has already put in the bucket. The size and type
 * are read back from storage rather than taken from the client, so the listing
 * cannot be made to lie about what was uploaded, and an object that breaks the
 * rules is deleted instead of being left orphaned in the bucket.
 */
export async function registerCohortFile(
  input: RegisterCohortFileInput,
  actor: CohortFileActor,
) {
  assertCohortNumber(input.cohortNumber);

  const fileName = sanitizeFileName(input.fileName);
  const supabase = createAdminClient();

  if (
    input.storagePath !==
    `${cohortFolderName(input.cohortNumber)}/${input.folder}/${input.fileId}-${fileName}`
  ) {
    throw new Error("That upload does not belong to this folder.");
  }

  const stored = await readStoredObject(input.storagePath);

  if (!stored) {
    throw new Error("The upload did not finish; please try again.");
  }

  async function discard(reason: string) {
    await supabase.storage.from(bucketId).remove([input.storagePath]);

    return new Error(reason);
  }

  if (stored.size === 0) {
    throw await discard("That file is empty.");
  }

  if (stored.size > maxUploadBytes) {
    throw await discard(
      `That file is ${stored.size.toLocaleString()} bytes, over the ${formatBytes(maxUploadBytes)} limit.`,
    );
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
      id: input.fileId,
      byte_size: stored.size,
      checksum_sha256: input.checksumSha256 ?? null,
      cohort_number: input.cohortNumber,
      content_type: stored.contentType,
      description: input.description ?? null,
      file_name: fileName,
      folder: input.folder,
      storage_path: input.storagePath,
      student_user_id: input.studentUserId ?? null,
      uploaded_by: actor.userId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw await discard(error.message);
  }

  await recordEvent(
    input.cohortNumber,
    input.fileId,
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
