import Link from "next/link";
import { FolderOpen } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireManager } from "@/lib/auth";
import {
  formatBytes,
  listCohortRepositories,
  cohortFileFolders,
} from "@/lib/cohort-files";
import {
  cohortConfig,
  formatCohortStartDate,
  getCohortSchedule,
  getCurrentCohortNumber,
  getNextCohortNumber,
} from "@/lib/cohorts";
import { formatDateTime } from "@/lib/format";

type PageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function AdminFilesPage({ searchParams }: PageProps) {
  const { roles } = await requireManager();
  const params = await searchParams;
  const repositories = await listCohortRepositories();

  // Every cohort up to the one in progress gets a folder whether or not it
  // holds anything yet, so staff can file a document the moment it exists.
  const latest = Math.min(
    getCurrentCohortNumber() ?? getNextCohortNumber() ?? 1,
    cohortConfig.lastCohortNumber,
  );
  const cohortNumbers = Array.from(
    new Set([
      ...repositories.map((entry) => entry.cohortNumber),
      ...Array.from({ length: latest }, (_, index) => index + 1),
    ]),
  ).sort((a, b) => b - a);
  const byCohort = new Map(
    repositories.map((entry) => [entry.cohortNumber, entry]),
  );
  const totalFiles = repositories.reduce(
    (total, entry) => total + entry.fileCount,
    0,
  );
  const totalBytes = repositories.reduce(
    (total, entry) => total + entry.totalBytes,
    0,
  );

  return (
    <AppShell roles={roles} title="Cohort Files">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.notice ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.notice}
        </p>
      ) : null}

      <Card eyebrow="Document Repository" title="One folder per cohort">
        <p className="max-w-3xl text-sm leading-6 text-slate-300">
          Transcripts, lab evidence exports and cohort reports are kept here
          instead of being emailed as one-off attachments. Open a cohort to
          browse, upload or download its documents. A transcript filed against a
          student also appears on that student&apos;s own Documents page; nobody
          else can download it.
        </p>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          {totalFiles} file{totalFiles === 1 ? "" : "s"} stored
          {totalFiles ? ` (${formatBytes(totalBytes)})` : ""} across{" "}
          {repositories.length} cohort
          {repositories.length === 1 ? "" : "s"}. Folders in every cohort:{" "}
          {cohortFileFolders.map((entry) => entry.label).join(", ")}.
        </p>
      </Card>

      <Card eyebrow="Browse" title="Cohorts">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Started</th>
                <th>Files</th>
                <th>Size</th>
                <th>Last updated</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {cohortNumbers.map((cohortNumber) => {
                const summary = byCohort.get(cohortNumber);

                return (
                  <tr key={cohortNumber}>
                    <td>Cohort {cohortNumber}</td>
                    <td>
                      {formatCohortStartDate(
                        getCohortSchedule(cohortNumber).startDate,
                      )}
                    </td>
                    <td>{summary?.fileCount ?? 0}</td>
                    <td>
                      {summary ? formatBytes(summary.totalBytes) : "Empty"}
                    </td>
                    <td>
                      {summary?.lastUpdatedAt
                        ? formatDateTime(summary.lastUpdatedAt)
                        : "—"}
                    </td>
                    <td>
                      <Link
                        className="inline-flex items-center gap-2 text-cyan-300 hover:underline"
                        href={`/admin/files/${cohortNumber}`}
                      >
                        <FolderOpen aria-hidden="true" size={16} />
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
