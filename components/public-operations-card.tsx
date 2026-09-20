import { Activity, Radio, Users } from "lucide-react";

import type { PublicOperationsSummary } from "@/lib/public-operations";

const statusDetails = {
  gray: {
    label: "Status updating",
    tone: "bg-slate-400",
    valueTone: "text-slate-600",
  },
  green: {
    label: "Operational",
    tone: "bg-emerald-500",
    valueTone: "text-emerald-700",
  },
  red: {
    label: "Unavailable",
    tone: "bg-rose-400",
    valueTone: "text-rose-700",
  },
  yellow: {
    label: "Limited availability",
    tone: "bg-amber-300",
    valueTone: "text-amber-700",
  },
};

export function PublicOperationsCard({
  summary,
}: {
  summary: PublicOperationsSummary;
}) {
  const status = statusDetails[summary.labStatus];
  const checkedAt = summary.checkedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(summary.checkedAt))
    : null;

  return (
    <section aria-labelledby="operations-title" className="card w-full">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-200 bg-cyan-50 text-cyan-700">
          <Activity aria-hidden="true" size={19} />
        </span>
        <div>
          <p className="eyebrow">Live Operations</p>
          <h2 className="mt-1 text-lg font-semibold" id="operations-title">
            Lab at a glance
          </h2>
        </div>
      </div>

      <dl className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
        <div className="flex items-center justify-between gap-4 py-4">
          <dt className="flex items-center gap-2 text-sm text-slate-600">
            <Users aria-hidden="true" className="text-cyan-700" size={17} />
            Active students
          </dt>
          <dd className="whitespace-nowrap text-xl font-bold text-slate-900">
            {summary.activeStudents ?? "--"}
            <span className="ml-1 text-sm font-semibold text-slate-500">
              / {summary.capacity}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-4">
          <dt className="flex items-center gap-2 text-sm text-slate-600">
            <Radio aria-hidden="true" className="text-cyan-700" size={17} />
            Lab status
          </dt>
          <dd
            className={`flex items-center justify-end gap-2 text-right text-sm font-bold ${status.valueTone}`}
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${status.tone}`}
            />
            {status.label}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        {checkedAt
          ? summary.labStatus === "gray"
            ? `Last monitor report received at ${checkedAt}.`
            : `Lab monitor verified at ${checkedAt}.`
          : "Live monitoring data is being refreshed."}
      </p>
    </section>
  );
}

export function PublicOperationsCardFallback() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading live lab operations"
      className="card min-h-72 w-full animate-pulse"
    >
      <div className="h-10 w-44 rounded-md bg-slate-200" />
      <div className="mt-7 h-14 rounded-md bg-slate-100" />
      <div className="mt-px h-14 rounded-md bg-slate-100" />
      <div className="mt-5 h-4 w-48 rounded bg-slate-200" />
    </section>
  );
}
