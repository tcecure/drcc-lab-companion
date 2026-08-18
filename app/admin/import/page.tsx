import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import {
  importCsvAction,
  importManualAction,
} from "@/lib/actions/import-students";
import { requireManager } from "@/lib/auth";
import { formatCohortStartDate, listCohortOptions } from "@/lib/cohorts";

type ImportPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function ImportPage({ searchParams }: ImportPageProps) {
  const { roles } = await requireManager();
  const params = await searchParams;
  const cohorts = listCohortOptions();

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
      <Card eyebrow="How Intake Works" title="Queue first, numbers later">
        <p className="text-sm leading-6 text-slate-300">
          Imported students are added to the lab queue and emailed a
          confirmation naming the session start date. Student numbers, pods, and
          lab usernames are assigned automatically at 1:00 AM Eastern on the
          cohort start date, then a second email delivers portal access.
        </p>
      </Card>
      <section className="grid gap-4 xl:grid-cols-2">
        <Card eyebrow="CSV Upload" title="Upload participant export">
          <form action={importCsvAction} className="grid gap-4">
            <input
              accept=".csv,text/csv"
              className="input"
              name="csvFile"
              required
              type="file"
            />
            <CohortSelect cohorts={cohorts} />
            <p className="text-sm leading-6 text-slate-300">
              Only Name (or First / Last Name), Email, and the booking start
              time are read from the participant export; every other column is
              ignored.
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
            <CohortSelect cohorts={cohorts} />
            <SubmitButton>Import manual entries</SubmitButton>
          </form>
        </Card>
      </section>
    </AppShell>
  );
}

function CohortSelect({
  cohorts,
}: {
  cohorts: { cohortNumber: number; startDate: string }[];
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      Cohort
      <select className="input" defaultValue="auto" name="cohortNumber">
        <option value="auto">
          Match each student to their form date (next cohort if blank)
        </option>
        {cohorts.map((cohort) => (
          <option key={cohort.cohortNumber} value={cohort.cohortNumber}>
            Cohort {cohort.cohortNumber} — starts{" "}
            {formatCohortStartDate(cohort.startDate)}
          </option>
        ))}
      </select>
    </label>
  );
}
