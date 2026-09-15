import Link from "next/link";
import { Activity, HeartHandshake } from "lucide-react";

/**
 * The two views of the same Moodle integration: admin-only Live Operations and
 * the donor-facing, PII-free Impact page.
 */
export function ImpactViewSwitcher({
  current,
}: {
  current: "impact" | "live";
}) {
  return (
    <nav aria-label="Moodle reporting views" className="flex flex-wrap gap-3">
      <Link
        aria-current={current === "impact" ? "page" : undefined}
        className={current === "impact" ? "button" : "button secondary"}
        href="/admin/community-impact"
      >
        <HeartHandshake aria-hidden="true" size={17} />
        Impact
      </Link>
      <Link
        aria-current={current === "live" ? "page" : undefined}
        className={current === "live" ? "button" : "button secondary"}
        href="/admin/community-impact/live"
      >
        <Activity aria-hidden="true" size={17} />
        Live Operations
      </Link>
    </nav>
  );
}
