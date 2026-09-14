import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { ImpactViewSwitcher } from "@/components/impact-view-switcher";
import {
  ConnectorHealthPanel,
  LiveOpsControls,
  LiveOpsSummary,
  LiveOpsTable,
  liveOpsRefreshMs,
} from "@/components/live-operations";
import { requireAdmin } from "@/lib/auth";
import { parseLiveOpsParams } from "@/lib/live-ops";
import {
  readActivitySummary,
  readConnectorHealth,
  readLiveOps,
  readLiveOpsFilterOptions,
} from "@/lib/moodle/live-ops-queries";
import { readTrackedCourses } from "@/lib/moodle/queries";

type LiveOperationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function LiveOperationsPage({
  searchParams,
}: LiveOperationsPageProps) {
  const [{ roles }, rawParams] = await Promise.all([
    requireAdmin(),
    searchParams,
  ]);
  const params = parseLiveOpsParams(rawParams);

  const [{ entries, error, total }, summary, connectors, options, courses] =
    await Promise.all([
      readLiveOps(params),
      readActivitySummary(params.window),
      readConnectorHealth(),
      readLiveOpsFilterOptions(),
      readTrackedCourses(),
    ]);

  return (
    <AppShell roles={roles} title="Live Operations">
      <AutoRefresh intervalMs={liveOpsRefreshMs} />
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-200/15 pb-5">
        <div>
          <p className="eyebrow">Administrator view</p>
          <h2 className="mt-2 text-2xl font-bold">Live Operations</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            User-level operational and security information for staff. Activity
            is derived from real Moodle log events; lab sessions come from
            Guacamole. Read-only.
          </p>
        </div>
        <ImpactViewSwitcher current="live" />
      </section>
      {error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          Live Operations could not be read: {error}
        </p>
      ) : null}
      <LiveOpsSummary
        activeInWindow={summary.activeInWindow}
        inGuacamoleSession={summary.inGuacamoleSession}
        learners={summary.learners}
        needsAttention={summary.needsAttention}
        params={params}
      />
      <ConnectorHealthPanel connectors={connectors} />
      <LiveOpsControls courses={courses} options={options} params={params} />
      <LiveOpsTable entries={entries} params={params} total={total} />
    </AppShell>
  );
}
