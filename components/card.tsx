import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
  href,
  label,
  value,
}: {
  helper: string;
  href?: string;
  label: string;
  value: string | number;
}) {
  const metric = (
    <Card eyebrow="Live metric">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold">{label}</h2>
        <p className="text-3xl font-bold">{value}</p>
      </div>
      <p className="mt-5 text-sm leading-6 text-slate-300">{helper}</p>
      {href ? (
        <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-cyan-200">
          View details
          <ArrowRight aria-hidden="true" size={16} />
        </span>
      ) : null}
    </Card>
  );

  return href ? (
    <Link
      aria-label={`View ${label} details`}
      className="group block rounded-xl transition duration-200 hover:-translate-y-0.5 hover:[&_.card]:border-cyan-300/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300"
      href={href}
      prefetch={true}
    >
      {metric}
    </Link>
  ) : (
    metric
  );
}
