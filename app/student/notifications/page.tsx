import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";

export default async function NotificationsPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);

  return (
    <AppShell roles={roles} title="Notifications">
      <Card eyebrow="Inbox" title="Student notifications">
        <p className="text-sm leading-6 text-slate-300">
          Cohort notifications and access reminders will appear here.
        </p>
      </Card>
    </AppShell>
  );
}
