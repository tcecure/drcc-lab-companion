import type { Database } from "@/lib/types";

export type CohortFileRow = Database["public"]["Tables"]["cohort_files"]["Row"];

export type CohortFileFolder = CohortFileRow["folder"];

export const bucketId = "cohort-files";

/**
 * Transcripts and evidence exports are documents, not media: 50 MB is far
 * above anything the generator produces and still small enough that a mistaken
 * upload cannot fill the bucket.
 */
export const maxUploadBytes = 50 * 1024 * 1024;

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
    folder: "certificates",
    label: "Certificates",
    description:
      "Completion certificates issued to individual students, kept apart from their transcripts.",
  },
  {
    folder: "guides",
    label: "Cohort Guides",
    description:
      "The guide and reference PDFs this cohort worked from. Course material, never a record of a student's results.",
  },
  {
    folder: "reports",
    label: "Cohort Reports",
    description:
      "Staff-facing documents about the cohort as a whole: rosters, summaries, funder reporting.",
  },
];

/**
 * Folders whose documents belong to one learner. Course material (guides) and
 * whole-cohort reporting must not be filed against a student: a transcript and
 * a guide PDF are different kinds of document and are kept in separate
 * folders so an issued record is never mixed in with the material.
 */
export const studentOwnedFolders: CohortFileFolder[] = [
  "transcripts",
  "certificates",
  "evidence",
];

export function isStudentOwnedFolder(folder: CohortFileFolder) {
  return studentOwnedFolders.includes(folder);
}

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
