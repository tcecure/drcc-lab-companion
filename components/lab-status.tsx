import type { LabStatusSummary } from "@/lib/proxmox/status";

const colorClasses = {
  gray: "border-slate-400/30 bg-slate-400/15 text-slate-100",
  green: "border-cyan-300/40 bg-cyan-300/20 text-cyan-50",
  red: "border-rose-300/40 bg-rose-400/20 text-rose-50",
  yellow: "border-amber-300/45 bg-amber-300/20 text-amber-50",
};

export function LabStatusCard({ status }: { status: LabStatusSummary }) {
  const pods = status.pods.flatMap((pod) =>
    pod.components.map((component) => ({
      ...component,
      name:
        pod.components.length > 1 ? `${pod.pod} · ${component.name}` : pod.pod,
    })),
  );

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Live metric</p>
          <h2 className="mt-2 text-base font-semibold">Lab Status</h2>
        </div>
        <span
          className={`inline-flex min-w-24 items-center justify-center rounded-full border px-3 py-1 text-sm font-extrabold ${colorClasses[status.color]}`}
        >
          <span className="mr-2 size-2 rounded-full bg-current" />
          {status.label}
        </span>
      </div>
      <p className="mt-5 text-sm leading-6 text-slate-300">{status.detail}</p>
      <p className="mt-2 text-xs text-slate-400">
        Checked {new Date(status.checkedAt).toLocaleString()} · {status.source}
      </p>
      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <StatusGroup label="Core domain controllers" rows={status.coreDCs} />
        <StatusGroup label="Pod components" rows={pods} />
      </div>
    </section>
  );
}

function StatusGroup({
  label,
  rows,
}: {
  label: string;
  rows: Array<{ name: string; online: boolean; status: string }>;
}) {
  return (
    <div className="rounded-lg border border-cyan-200/10 bg-white/[0.04] p-3">
      <p className="font-bold text-cyan-100">{label}</p>
      <div className="mt-2 grid gap-1">
        {rows.length ? (
          rows.map((row) => (
            <div
              className="flex items-center justify-between gap-3"
              key={row.name}
            >
              <span className="truncate text-slate-300">{row.name}</span>
              <span className={row.online ? "text-cyan-100" : "text-amber-100"}>
                {row.status}
              </span>
            </div>
          ))
        ) : (
          <p className="text-slate-400">No expected items configured.</p>
        )}
      </div>
    </div>
  );
}
