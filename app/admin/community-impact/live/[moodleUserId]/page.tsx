import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ImpactViewSwitcher } from "@/components/impact-view-switcher";
import { StudentDetailDrawer } from "@/components/live-operations";
import { requireAdmin } from "@/lib/auth";
import { parseLiveOpsParams } from "@/lib/live-ops";
import { readStudentDetail } from "@/lib/moodle/live-ops-queries";

type StudentDetailPageProps = {
  params: Promise<{ moodleUserId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({
  params,
  searchParams,
}: StudentDetailPageProps) {
  const [{ roles }, routeParams, rawParams] = await Promise.all([
    requireAdmin(),
    params,
    searchParams,
  ]);

  const moodleUserId = Number(routeParams.moodleUserId);

  if (!Number.isInteger(moodleUserId) || moodleUserId <= 0) {
    notFound();
  }

  const detail = await readStudentDetail(moodleUserId);

  return (
    <AppShell roles={roles} title="Live Operations">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-200/15 pb-5">
        <div>
          <p className="eyebrow">Administrator view</p>
          <h2 className="mt-2 text-2xl font-bold">Student detail</h2>
        </div>
        <ImpactViewSwitcher current="live" />
      </section>
      <StudentDetailDrawer
        detail={detail}
        params={parseLiveOpsParams(rawParams)}
      />
    </AppShell>
  );
}
