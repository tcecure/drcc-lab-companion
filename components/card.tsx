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
    <Card className="metric-card">
      <p className="metric-card-label">{label}</p>
      <p className="metric-card-value">{value}</p>
      <p className="metric-card-helper">{helper}</p>
      {href ? (
        <span className="metric-card-action">
          View details
          <ArrowRight aria-hidden="true" size={16} />
        </span>
      ) : null}
    </Card>
  );

  return href ? (
    <Link
      aria-label={`View ${label} details`}
      className="metric-card-link"
      href={href}
      prefetch={true}
    >
      {metric}
    </Link>
  ) : (
    metric
  );
}
