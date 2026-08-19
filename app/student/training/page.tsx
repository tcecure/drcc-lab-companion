import Link from "next/link";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { TrainingProgressPanel } from "@/components/training-progress";
import { getUserRoles, requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  getStudentCohortAssignment,
  getStudentLabIdentity,
} from "@/lib/student-lab";
import { getPodProgress } from "@/lib/training-progress";

export const dynamic = "force-dynamic";

function NoTrainingAssignment() {
  return (
    <Card eyebrow="Hands-on labs" title="Training progress">
      <p className="text-sm leading-6 text-slate-300">
        Your lab progress appears here once you are assigned a student number
        and pod, at 1:00 AM Eastern on your session start date.
      </p>
    </Card>
  );
}

function TrainingProgressFallback({ podName }: { podName: string }) {
  return (
    <Card eyebrow={`${podName} · syncing`} title="Training progress">
      <div aria-busy="true" aria-label="Loading training progress">
        <div className="h-4 w-56 max-w-full animate-pulse rounded bg-white/10" />
        <div className="mt-5 h-2 w-full animate-pulse rounded-full bg-white/10" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-lg bg-white/5" />
          <div className="h-24 animate-pulse rounded-lg bg-white/5" />
        </div>
      </div>
    </Card>
  );
}

async function TrainingProgressDetails({ podName }: { podName: string }) {
  const progress = await getPodProgress(podName);

  if (!progress) {
    return <NoTrainingAssignment />;
  }

  return (
    <Card
      eyebrow={`${progress.podName} · verified automatically`}
      title="Training progress"
    >
      <TrainingProgressPanel progress={progress} />
      {progress.status !== "unavailable" ? (
        <p className="mt-6 text-sm text-slate-400">
          Last verification run: {formatDateTime(progress.checkedAt)}. Progress
          is graded from the evidence your labs produce, so it updates after
          each verification run rather than instantly.
        </p>
      ) : null}
      <Link className="button mt-5" href="/student/guides">
        Open lab guides
      </Link>
    </Card>
  );
}

export default async function TrainingPage() {
  const user = await requireUser();
  const [roles, assignment] = await Promise.all([
    getUserRoles(user.id),
    getStudentCohortAssignment(user.id),
  ]);
  const identity = getStudentLabIdentity(assignment);

  return (
    <AppShell roles={roles} title="Training">
      {!identity ? (
        <NoTrainingAssignment />
      ) : (
        <Suspense
          fallback={<TrainingProgressFallback podName={identity.podName} />}
        >
          <TrainingProgressDetails podName={identity.podName} />
        </Suspense>
      )}
    </AppShell>
  );
}
