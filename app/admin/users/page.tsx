import { AppShell } from "@/components/app-shell";
import { Card, MetricCard } from "@/components/card";
import { SubmitButton } from "@/components/forms";
import {
  inviteStaffUserAction,
  sendStaffPasswordSetupAction,
  updateStaffAccessAction,
  updateStaffRoleAction,
} from "@/lib/actions/manage-staff";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listStaffUsers, staffRoles } from "@/lib/staff-users";

type UserManagementPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function UserManagementPage({
  searchParams,
}: UserManagementPageProps) {
  const { roles, user } = await requireAdmin();
  const [staffUsers, params] = await Promise.all([
    listStaffUsers(),
    searchParams,
  ]);
  const adminCount = staffUsers.filter(
    (staffUser) => staffUser.role === "admin",
  ).length;
  const approverCount = staffUsers.filter(
    (staffUser) => staffUser.role === "approver",
  ).length;
  const invitedCount = staffUsers.filter(
    (staffUser) => staffUser.authStatus === "invited",
  ).length;

  return (
    <AppShell roles={roles} title="User Management">
      {params.error ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-3 text-sm text-rose-100">
          {params.error}
        </p>
      ) : null}
      {params.message ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          {params.message}
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          helper="Global portal administrators with full control."
          label="Admins"
          value={adminCount}
        />
        <MetricCard
          helper="Operations staff who can approve requests and manage cohorts."
          label="Approvers"
          value={approverCount}
        />
        <MetricCard
          helper="Staff invitations that have not completed account setup."
          label="Pending Invites"
          value={invitedCount}
        />
      </section>

      <Card eyebrow="Staff Access" title="Invite a staff user">
        <form
          action={inviteStaffUserAction}
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem_auto] lg:items-end"
        >
          <label className="grid gap-2 text-sm font-semibold">
            Full name
            <input className="input" name="fullName" required />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Email
            <input className="input" name="email" required type="email" />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Role
            <select className="input" defaultValue="approver" name="role">
              {staffRoles.map((role) => (
                <option key={role} value={role}>
                  {role === "admin" ? "Admin" : "Approver"}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton>Send invitation</SubmitButton>
        </form>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          Invitations are for staff only. Student accounts remain in the
          separate intake and cohort workflows.
        </p>
      </Card>

      <Card eyebrow="Directory" title="Current staff users">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign in</th>
                <th>Account controls</th>
              </tr>
            </thead>
            <tbody>
              {staffUsers.map((staffUser) => {
                const currentUser = staffUser.id === user.id;

                return (
                  <tr key={staffUser.id}>
                    <td>
                      <p className="font-bold text-slate-100">
                        {staffUser.fullName}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {staffUser.email}
                      </p>
                      {currentUser ? (
                        <span className="mt-2 inline-flex text-xs font-bold text-cyan-200">
                          Your account
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {currentUser ? (
                        <span className="status-pill">{staffUser.role}</span>
                      ) : (
                        <form
                          action={updateStaffRoleAction}
                          className="flex min-w-56 items-center gap-2"
                        >
                          <input
                            name="targetUserId"
                            type="hidden"
                            value={staffUser.id}
                          />
                          <select
                            aria-label={`Role for ${staffUser.fullName}`}
                            className="input"
                            defaultValue={staffUser.role}
                            name="role"
                          >
                            {staffRoles.map((role) => (
                              <option key={role} value={role}>
                                {role === "admin" ? "Admin" : "Approver"}
                              </option>
                            ))}
                          </select>
                          <SubmitButton className="secondary">
                            Save
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                    <td>
                      <span
                        className={`activity-pill ${statusClass(staffUser.authStatus)}`}
                      >
                        {staffUser.authStatus}
                      </span>
                    </td>
                    <td>{formatLastSignIn(staffUser.lastSignInAt)}</td>
                    <td>
                      <div className="flex min-w-64 flex-wrap gap-2">
                        <form action={sendStaffPasswordSetupAction}>
                          <input
                            name="targetUserId"
                            type="hidden"
                            value={staffUser.id}
                          />
                          <SubmitButton className="secondary">
                            Send password setup
                          </SubmitButton>
                        </form>
                        {!currentUser ? (
                          <form action={updateStaffAccessAction}>
                            <input
                              name="targetUserId"
                              type="hidden"
                              value={staffUser.id}
                            />
                            <input
                              name="command"
                              type="hidden"
                              value={
                                staffUser.authStatus === "disabled"
                                  ? "restore"
                                  : "disable"
                              }
                            />
                            <SubmitButton
                              className={
                                staffUser.authStatus === "disabled"
                                  ? "secondary"
                                  : "danger"
                              }
                            >
                              {staffUser.authStatus === "disabled"
                                ? "Restore access"
                                : "Disable access"}
                            </SubmitButton>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {staffUsers.length === 0 ? (
                <tr>
                  <td className="text-slate-400" colSpan={5}>
                    No staff users were found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}

function statusClass(status: "active" | "disabled" | "invited") {
  if (status === "active") {
    return "activity-pill-active";
  }

  if (status === "disabled") {
    return "activity-pill-offline";
  }

  return "activity-pill-idle";
}

function formatLastSignIn(input: string | null) {
  return input ? formatDateTime(input) : "Never";
}
