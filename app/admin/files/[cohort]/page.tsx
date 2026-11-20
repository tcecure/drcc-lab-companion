import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireManager } from "@/lib/auth";
import {
  cohortFileFolders,
  formatBytes,
  listCohortFolders,
} from "@/lib/cohort-files";
import {
  cohortConfig,
  formatCohortStartDate,
  getCohortSchedule,
} from "@/lib/cohorts";
import { formatDateTime } from "@/lib/format";

type PageProps = {
  params: Promise<{ cohort: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function AdminCohortFolderPage({
  params,
  searchParams,
}: PageProps) {
  const { roles } = await requireManager();
  const { cohort } = await params;
  const query = await searchParams;
  const cohortNumber = Number(cohort);

  if (
    !Number.isInteger(cohortNumber) ||
    cohortNumber < 1 ||
    cohortNumber > cohortConfig.lastCohortNumber
  ) {
    notFound();
  }

  const folders = await listCohortFolders(cohortNumber);
  const schedule = getCohortSchedule(cohortNumber);

  return (
    <AppShell roles={roles} title={`Cohort ${cohortNumber} Files`}>
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

      <Card
        eyebrow={`Started ${formatCohortStartDate(schedule.startDate)}`}
        title={`Cohort ${cohortNumber}`}
      >
        <Link className="text-sm text-cyan-300 hover:underline" href="/admin/files">
          ← All cohorts
        </Link>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {folders.map((folder) => (
          <Card
            eyebrow={`${folder.fileCount} file${folder.fileCount === 1 ? "" : "s"}`}
            key={folder.folder}
            title={folder.label}
          >
            <FolderOpen aria-hidden="true" className="text-cyan-300" size={24} />
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {
                cohortFileFolders.find((entry) => entry.folder === folder.folder)
                  ?.description
              }
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              {folder.fileCount
                ? `${formatBytes(folder.totalBytes)} · updated ${formatDateTime(folder.lastUpdatedAt)}`
                : "Empty"}
            </p>
            <Link
              className="mt-4 inline-block text-sm text-cyan-300 hover:underline"
              href={`/admin/files/${cohortNumber}/${folder.folder}`}
            >
              Open folder
            </Link>
          </Card>
        ))}
      </section>
    </AppShell>
  );
}
