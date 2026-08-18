import { AppShell } from "@/components/app-shell";
import { Card, MetricCard } from "@/components/card";
import { LabStatusCard } from "@/components/lab-status";
import { requireManager } from "@/lib/auth";
import { getLabStatus } from "@/lib/proxmox/status";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminLabsPage() {
  const { roles } = await requireManager();
  const supabase = createAdminClient();
  const [{ data: settings }, { data: instances }, labStatus] =
    await Promise.all([
      supabase
        .from("lab_capacity_settings")
        .select("*")
        .is("lab_track_id", null)
        .maybeSingle(),
      supabase
        .from("lab_instances")
        .select("*")
        .order("pod_name", { ascending: true }),
      getLabStatus(),
    ]);
  const active = (instances ?? []).filter((row) =>
    ["reserved", "provisioning", "active", "expiring"].includes(row.status),
  ).length;

  return (
    <AppShell roles={roles} title="Lab Capacity">
      <LabStatusCard status={labStatus} />
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          helper="Maximum active hands-on users."
          label="Active Capacity"
          value={settings?.maximum_active ?? 20}
        />
        <MetricCard
          helper="Current active or reserved lab instances."
          label="In Use"
          value={active}
        />
        <MetricCard
          helper="Standard student access window."
          label="Window"
          value={`${settings?.standard_duration_days ?? 14} days`}
        />
      </section>
      <Card eyebrow="Proxmox Placeholder" title="Lab instances">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pod</th>
                <th>Status</th>
                <th>Environment</th>
                <th>Assigned User</th>
              </tr>
            </thead>
            <tbody>
              {(instances ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.pod_name}</td>
                  <td>
                    <span className="status-pill">{row.status}</span>
                  </td>
                  <td>{row.environment_identifier}</td>
                  <td>{row.assigned_user_id ?? "Unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
