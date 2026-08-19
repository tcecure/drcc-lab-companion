import Link from "next/link";

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

export default async function TrainingPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);
  const assignment = await getStudentCohortAssignment(user.id);
  const identity = getStudentLabIdentity(assignment);
  const progress = identity ? await getPodProgress(identity.podName) : null;

  return (
    <AppShell roles={roles} title="Training">
      {!identity || !progress ? (
        <Card eyebrow="Hands-on labs" title="Training progress">
          <p className="text-sm leading-6 text-slate-300">
            Your lab progress appears here once you are assigned a student
            number and pod, at 1:00 AM Eastern on your session start date.
          </p>
        </Card>
      ) : (
        <Card
          eyebrow={`${progress.podName} · verified automatically`}
          title="Training progress"
        >
          <TrainingProgressPanel progress={progress} />
          <p className="mt-6 text-sm text-slate-400">
            Last verification run: {formatDateTime(progress.checkedAt)}.
            Progress is graded from the evidence your labs produce, so it
            updates after each verification run rather than instantly.
          </p>
          <Link className="button mt-5" href="/student/guides">
            Open lab guides
          </Link>
        </Card>
      )}
    </AppShell>
  );
}
