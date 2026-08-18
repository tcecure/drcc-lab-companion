import Link from "next/link";
import { ArrowUpRight, Boxes, Clock3, Server, ShieldCheck } from "lucide-react";

import type { LabStatusSummary } from "@/lib/proxmox/status";

const colorClasses = {
  gray: "border-slate-400/30 bg-slate-400/15 text-slate-100",
  green: "border-cyan-300/40 bg-cyan-300/20 text-cyan-50",
  red: "border-rose-300/40 bg-rose-400/20 text-rose-50",
  yellow: "border-amber-300/45 bg-amber-300/20 text-amber-50",
};

export function LabStatusCard({
  href = "/admin/lab-status",
  status,
}: {
  href?: string | null;
  status: LabStatusSummary;
}) {
  const unavailable = status.color === "gray";
  const checkedAt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(status.checkedAt));

  const content = (
    <>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5 xl:items-center">
        <div className="sm:col-span-2 xl:col-span-1">
          <p className="eyebrow">Live metric</p>
          <div className="mt-2 flex items-center gap-2">
            <h2 className="text-base font-semibold">Lab Status</h2>
            {href ? (
              <span
                className="text-cyan-200 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                title="Open detailed lab metrics"
              >
                <ArrowUpRight aria-hidden="true" size={17} />
              </span>
            ) : null}
          </div>
          <span
            className={`mt-3 inline-flex min-w-24 items-center justify-center rounded-full border px-3 py-1 text-sm font-extrabold ${colorClasses[status.color]}`}
          >
            <span className="mr-2 size-2 rounded-full bg-current" />
            {status.label}
          </span>
        </div>
        <StatusSegment
          icon={Server}
          issueTone="yellow"
          label="Hypervisor"
          rows={status.hosts}
          unavailable={unavailable}
        />
        <StatusSegment
          icon={ShieldCheck}
          issueTone="red"
          label="Domain controllers"
          rows={status.coreDCs}
          unavailable={unavailable}
        />
        <StatusSegment
          icon={Boxes}
          issueTone="yellow"
          label="Lab pods"
          rows={status.pods.map((pod) => ({
            name: pod.pod,
            online: pod.online,
            status: pod.online ? "online" : "degraded",
          }))}
          unavailable={unavailable}
        />
        <div className="min-w-0 xl:border-l xl:border-cyan-200/10 xl:pl-5">
          <div className="flex items-center gap-2 text-slate-400">
            <Clock3 aria-hidden="true" size={16} />
            <p className="text-xs font-bold uppercase">Last check</p>
          </div>
          <p className="mt-2 text-base font-bold text-slate-100">{checkedAt}</p>
          <p className="mt-1 truncate text-xs text-slate-400">
            Central · {status.source}
          </p>
        </div>
      </div>
      <p className="mt-5 border-t border-cyan-200/10 pt-3 text-sm leading-6 text-slate-300">
        {status.detail}
      </p>
    </>
  );

  if (!href) {
    return <section className="card">{content}</section>;
  }

  return (
    <Link
      aria-label={`Lab Status: ${status.label}. Open detailed lab metrics`}
      className="card group block transition-colors hover:border-cyan-300/35"
      href={href}
    >
      {content}
    </Link>
  );
}

function StatusSegment({
  icon: Icon,
  issueTone,
  label,
  rows,
  unavailable,
}: {
  icon: typeof Server;
  issueTone: "red" | "yellow";
  label: string;
  rows: Array<{ name: string; online: boolean; status: string }>;
  unavailable: boolean;
}) {
  const online = rows.filter((row) => row.online).length;
  const allOnline = rows.length > 0 && online === rows.length;
  const value = unavailable
    ? "Unavailable"
    : rows.length
      ? `${online} / ${rows.length} online`
      : "Not configured";
  const detail = rows.length
    ? rows.map((row) => `${row.name}: ${row.status}`).join(" · ")
    : "No expected resources";
  const tone = unavailable
    ? "text-slate-400"
    : allOnline
      ? "text-cyan-200"
      : issueTone === "red"
        ? "text-rose-200"
        : "text-amber-200";

  return (
    <div className="min-w-0 xl:border-l xl:border-cyan-200/10 xl:pl-5">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon aria-hidden="true" size={16} />
        <p className="text-xs font-bold uppercase">{label}</p>
      </div>
      <p className={`mt-2 text-base font-bold ${tone}`}>{value}</p>
      <p className="mt-1 truncate text-xs text-slate-400" title={detail}>
        {detail}
      </p>
    </div>
  );
}
