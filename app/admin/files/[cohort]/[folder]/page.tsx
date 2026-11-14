import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import { CohortFileUpload } from "@/components/cohort-file-upload";
import { deleteCohortFileAction } from "@/lib/actions/cohort-files";
import { requireManager } from "@/lib/auth";
import {
  cohortFileFolders,
  formatBytes,
  isCohortFileFolder,
  isStudentOwnedFolder,
  listCohortFiles,
} from "@/lib/cohort-files";
import { cohortConfig } from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

type PageProps = {
  params: Promise<{ cohort: string; folder: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

async function listCohortRoster(cohortNumber: number) {
  const supabase = createAdminClient();
  const { data: assignments } = await supabase
    .from("student_cohort_assignments")
    .select("user_id, seat_number")
    .eq("cohort_number", cohortNumber)
    .neq("status", "cancelled");

  const userIds = (assignments ?? []).map((row) => row.user_id);

  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  const byId = new Map((profiles ?? []).map((row) => [row.id, row]));

  return (assignments ?? [])
    .map((row) => ({
      label: `${byId.get(row.user_id)?.full_name || byId.get(row.user_id)?.email || "Unknown"}${
        row.seat_number ? ` — seat ${row.seat_number}` : ""
      }`,
      userId: row.user_id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default async function AdminCohortFolderFilesPage({
  params,
  searchParams,
}: PageProps) {
  const { roles } = await requireManager();
  const { cohort, folder } = await params;
  const query = await searchParams;
  const cohortNumber = Number(cohort);

  if (
    !Number.isInteger(cohortNumber) ||
    cohortNumber < 1 ||
    cohortNumber > cohortConfig.lastCohortNumber ||
    !isCohortFileFolder(folder)
  ) {
    notFound();
  }

  const [files, roster] = await Promise.all([
    listCohortFiles(cohortNumber, folder),
    isStudentOwnedFolder(folder)
      ? listCohortRoster(cohortNumber)
      : Promise.resolve([]),
  ]);
  const definition = cohortFileFolders.find(
    (entry) => entry.folder === folder,
  )!;
  const env = readServerEnv();

  return (
    <AppShell
      roles={roles}
      title={`Cohort ${cohortNumber} · ${definition.label}`}
    >
      {query.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {query.error}
        </p>
      ) : null}
      {query.notice ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {query.notice}
        </p>
      ) : null}

      <Card eyebrow={`Cohort ${cohortNumber}`} title={definition.label}>
        <p className="max-w-3xl text-sm leading-6 text-slate-300">
          {definition.description}
        </p>
        <p className="mt-4 text-sm">
          <Link
            className="text-cyan-300 hover:underline"
            href={`/admin/files/${cohortNumber}`}
          >
            ← Cohort {cohortNumber}
          </Link>
        </p>
      </Card>

      <Card
        eyebrow="Contents"
        title={`${files.length} file${files.length === 1 ? "" : "s"}`}
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Belongs to</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>By</th>
                <th>Download</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>
                    {file.fileName}
                    {file.description ? (
                      <span className="block text-xs text-slate-400">
                        {file.description}
                      </span>
                    ) : null}
                  </td>
                  <td>{file.ownerName ?? "Staff only"}</td>
                  <td>{formatBytes(file.byteSize)}</td>
                  <td>{formatDateTime(file.createdAt)}</td>
                  <td>{file.uploadedByName ?? "—"}</td>
                  <td>
                    {/* A plain anchor: the route answers with a redirect to a
                        signed URL, which the client router cannot resolve. */}
                    <a
                      className="inline-flex items-center gap-2 text-cyan-300 hover:underline"
                      href={`/api/files/${file.id}`}
                    >
                      <Download aria-hidden="true" size={16} />
                      Download
                    </a>
                  </td>
                  <td>
                    <form action={deleteCohortFileAction}>
                      <input name="fileId" type="hidden" value={file.id} />
                      <SubmitButton className="secondary">Remove</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
              {files.length ? null : (
                <tr>
                  <td colSpan={7}>This folder is empty.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Add" title="Upload a document">
        <CohortFileUpload
          cohortNumber={cohortNumber}
          folder={folder}
          students={roster}
          supabaseKey={env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
          supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
        />
      </Card>
    </AppShell>
  );
}
