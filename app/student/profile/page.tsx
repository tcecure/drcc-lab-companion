import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/card";
import { getProfile, getUserRoles, requireUser } from "@/lib/auth";

export default async function ProfilePage() {
  const user = await requireUser();
  const [roles, profile] = await Promise.all([
    getUserRoles(user.id),
    getProfile(user.id),
  ]);

  return (
    <AppShell roles={roles} title="Profile">
      <Card eyebrow="Account" title="Profile">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">Name</dt>
            <dd className="font-bold">{profile?.full_name || "Not set"}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Email</dt>
            <dd className="font-bold">{profile?.email || user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Organization</dt>
            <dd className="font-bold">{profile?.organization || "Not set"}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Status</dt>
            <dd className="font-bold capitalize">
              {profile?.account_status ?? "active"}
            </dd>
          </div>
        </dl>
      </Card>
    </AppShell>
  );
}
