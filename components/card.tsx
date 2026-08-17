import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  eyebrow,
  title,
}: {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      {title ? <h2 className="mt-2 text-xl font-semibold">{title}</h2> : null}
      <div className={title || eyebrow ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function MetricCard({
  helper,
  label,
  value,
}: {
  helper: string;
  label: string;
  value: string | number;
}) {
  return (
    <Card eyebrow="Live metric">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold">{label}</h2>
        <p className="text-3xl font-bold">{value}</p>
      </div>
      <p className="mt-5 text-sm leading-6 text-slate-300">{helper}</p>
    </Card>
  );
}
