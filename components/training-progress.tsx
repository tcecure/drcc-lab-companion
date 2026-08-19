import type { PodProgress, ProgressStatus } from "@/lib/training-progress";

const statusLabels: Record<ProgressStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  unavailable: "Unavailable",
};

const statusStyles: Record<ProgressStatus, string> = {
  not_started: "border-slate-300/30 bg-slate-300/10 text-slate-200",
  in_progress: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  completed: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
  unavailable: "border-slate-300/30 bg-slate-300/10 text-slate-300",
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
      ? "bg-cyan-300"
      : status === "in_progress"
        ? "bg-amber-300"
        : "bg-slate-500";

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percentage}
      className="h-2 w-full overflow-hidden rounded-full bg-white/10"
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
      <p className="rounded-lg border border-slate-300/30 bg-slate-300/10 p-4 text-sm leading-6 text-slate-300">
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
