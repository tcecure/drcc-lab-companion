import Link from "next/link";
import { Download } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { requireUser, getUserRoles } from "@/lib/auth";
import { folderLabel, formatBytes, listStudentFiles } from "@/lib/cohort-files";
import { formatDateTime } from "@/lib/format";

export default async function StudentDocumentsPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const files = await listStudentFiles(user.id);

  return (
    <AppShell roles={roles} title="My Documents">
      <Card eyebrow="Your Records" title="Documents issued to you">
        <p className="max-w-3xl text-sm leading-6 text-slate-300">
          Your learning report and any evidence we file for you appear here once
          staff publish them, usually at the end of your cohort. Only you and
          DigitalRCC staff can open these.
        </p>
      </Card>

      <Card eyebrow="Downloads" title={`${files.length} document${files.length === 1 ? "" : "s"}`}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Size</th>
                <th>Published</th>
                <th>Download</th>
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
                  <td>{folderLabel(file.folder)}</td>
                  <td>{formatBytes(file.byteSize)}</td>
                  <td>{formatDateTime(file.createdAt)}</td>
                  <td>
                    <Link
                      className="inline-flex items-center gap-2 text-cyan-300 hover:underline"
                      href={`/api/files/${file.id}`}
                    >
                      <Download aria-hidden="true" size={16} />
                      Download
                    </Link>
                  </td>
                </tr>
              ))}
              {files.length ? null : (
                <tr>
                  <td colSpan={5}>
                    Nothing published yet. Your learning report is issued after
                    your cohort finishes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
