import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import {
  importCsvAction,
  importManualAction,
} from "@/lib/actions/import-students";
import { requireManager } from "@/lib/auth";

type ImportPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function ImportPage({ searchParams }: ImportPageProps) {
  const { roles } = await requireManager();
  const params = await searchParams;

  return (
    <AppShell roles={roles} title="Import Students">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.message}
        </p>
      ) : null}
      <section className="grid gap-4 xl:grid-cols-2">
        <Card eyebrow="CSV Upload" title="Upload participant export">
          <form action={importCsvAction} className="grid gap-4">
            <input className="input" name="csvFile" required type="file" />
            <p className="text-sm leading-6 text-slate-300">
              Accepts the current participant CSV export and extracts name plus
              email.
            </p>
            <SubmitButton>Upload CSV</SubmitButton>
          </form>
        </Card>
        <Card eyebrow="Manual Entry" title="Add up to 10 students">
          <form action={importManualAction} className="grid gap-3">
            {Array.from({ length: 10 }).map((_, index) => (
              <div className="grid gap-3 sm:grid-cols-2" key={index}>
                <input
                  className="input"
                  name={`student-${index}-name`}
                  placeholder={`Student ${index + 1} name`}
                />
                <input
                  className="input"
                  name={`student-${index}-email`}
                  placeholder="email@example.com"
                  type="email"
                />
              </div>
            ))}
            <SubmitButton>Import manual entries</SubmitButton>
          </form>
        </Card>
      </section>
    </AppShell>
  );
}
