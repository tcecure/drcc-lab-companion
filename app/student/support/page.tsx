import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getUserRoles, requireUser } from "@/lib/auth";

export default async function SupportPage() {
  const user = await requireUser();
  const roles = await getUserRoles(user.id);

  return (
    <AppShell roles={roles} title="Support">
      <Card eyebrow="Help Desk" title="Need help?">
        <p className="text-sm leading-6 text-slate-300">
          Contact your DigitalRCC approver or lab facilitator for access, queue,
          or environment support during the testing window.
        </p>
      </Card>
    </AppShell>
  );
}
