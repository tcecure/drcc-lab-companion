import type { PodProgress, ProgressStatus } from "@/lib/training-progress";

const statusLabels: Record<ProgressStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  unavailable: "Unavailable",
};

const statusStyles: Record<ProgressStatus, string> = {
  not_started: "border-slate-200 bg-slate-100 text-slate-600",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unavailable: "border-slate-200 bg-slate-100 text-slate-600",
};

export function ProgressBar({
  label,
  percentage,
  status,
}: {
  label: string;
  percentage: number;
  status: ProgressStatus;
}) {
  const fill =
    status === "completed"
      ? "bg-emerald-500"
      : status === "in_progress"
        ? "bg-blue-600"
        : "bg-slate-500";

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percentage}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
    >
      <div className={`h-full ${fill}`} style={{ width: `${percentage}%` }} />
    </div>
  );
}

export function StatusPill({ status }: { status: ProgressStatus }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

export function TrainingProgressPanel({ progress }: { progress: PodProgress }) {
  if (progress.status === "unavailable") {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Live progress for {progress.podName} is temporarily unavailable, so no
        percentage is shown. Your completed work is not affected — the tracker
        reports again on its next verification run.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">
              {progress.completedModules} of {progress.totalModules} lab
              families complete
              {progress.currentModule
                ? ` · currently on ${progress.currentModule}`
                : ""}
            </p>
          </div>
          <p className="text-3xl font-bold">{progress.overallPercentage}%</p>
        </div>
        <ProgressBar
          label="Overall lab progress"
          percentage={progress.overallPercentage}
          status={progress.status}
        />
      </div>
      <ul className="flex flex-col gap-4">
        {progress.modules.map((module) => (
          <li className="flex flex-col gap-2" key={module.id}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold">
                {module.id} · {module.title}
              </p>
              <div className="flex items-center gap-3">
                <StatusPill status={module.status} />
                <p className="w-10 text-right text-sm font-semibold">
                  {module.percentage}%
                </p>
              </div>
            </div>
            <ProgressBar
              label={`${module.title} progress`}
              percentage={module.percentage}
              status={module.status}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
