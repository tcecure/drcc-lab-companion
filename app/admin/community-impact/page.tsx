import Link from "next/link";
import { Presentation } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import {
  CredibilityPanel,
  ImpactCards,
  PresentationView,
  RosterControls,
  RosterTable,
} from "@/components/community-impact";
import { requireAdmin } from "@/lib/auth";
import { buildRosterHref, parseRosterParams } from "@/lib/moodle/impact";
import {
  readImpactMetrics,
  readRoster,
  readTrackedCourses,
} from "@/lib/moodle/queries";

type CommunityImpactPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function CommunityImpactPage({
  searchParams,
}: CommunityImpactPageProps) {
  const [{ roles }, rawParams] = await Promise.all([
    requireAdmin(),
    searchParams,
  ]);
  const params = parseRosterParams(rawParams);
  const presentation = rawParams.mode === "presentation";
  const metrics = await readImpactMetrics();

  if (presentation) {
    return <PresentationView metrics={metrics} params={params} />;
  }

  const [{ entries, total }, courses] = await Promise.all([
    readRoster(params),
    readTrackedCourses(),
  ]);
  const message =
    typeof rawParams.message === "string" ? rawParams.message : null;
  const error = typeof rawParams.error === "string" ? rawParams.error : null;

  return (
    <AppShell roles={roles} title="Community Impact">
      {error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {message}
        </p>
      ) : null}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-200/15 pb-5">
        <div>
          <p className="eyebrow">Moodle-derived reporting</p>
          <h2 className="mt-2 text-2xl font-bold">Community impact</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Every number below comes from a read-only Moodle synchronization.
            Nothing is estimated or generated.
          </p>
        </div>
        <Link
          className="button secondary"
          href={buildRosterHref(params, { presentation: true })}
        >
          <Presentation aria-hidden="true" size={17} />
          Presentation Mode
        </Link>
      </section>
      <ImpactCards metrics={metrics} />
      <CredibilityPanel metrics={metrics} />
      <RosterControls
        courses={courses}
        params={params}
        returnTo={buildRosterHref(params, {})}
      />
      <RosterTable entries={entries} params={params} total={total} />
    </AppShell>
  );
}
