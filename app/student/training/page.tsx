import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";

export default async function TrainingPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);

  return (
    <AppShell roles={roles} title="Training">
      <Card eyebrow="Moodle" title="Training progress">
        <p className="text-sm leading-6 text-slate-300">
          Moodle progress integration will attach here. For this testing build,
          students use this workspace to access lab guides and track cohort
          timing.
        </p>
      </Card>
    </AppShell>
  );
}
