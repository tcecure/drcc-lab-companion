import { Card, MetricCard } from "@/components/card";
import { AppShell } from "@/components/app-shell";
import { LabStatusCard } from "@/components/lab-status";
import { requireManager } from "@/lib/auth";
import type { ProxmoxNodeRow, ProxmoxResourceRow } from "@/lib/proxmox/health";
import {
  formatBytes,
  formatPercent,
  formatUptime,
  formatUsage,
} from "@/lib/proxmox/metrics";
import { getLabStatus, getLatestLabSnapshot } from "@/lib/proxmox/status";

const targetNodeName = "pve1";

export default async function AdminLabStatusPage() {
  const { roles } = await requireManager();
  const [status, snapshot] = await Promise.all([
    getLabStatus(),
    getLatestLabSnapshot(),
  ]);
  const node = snapshot?.nodes.find(
    (candidate) => candidate.node === targetNodeName,
  );
  const resources = (snapshot?.resources ?? [])
    .filter((resource) => resource.node === targetNodeName)
    .sort(
      (left, right) =>
        (left.vmid ?? Number.MAX_SAFE_INTEGER) -
        (right.vmid ?? Number.MAX_SAFE_INTEGER),
    );
  const running = resources.filter(
    (resource) => resource.status === "running",
  ).length;
  const metricsAvailable = hasMetrics(node, resources);
  const cpuUsage = formatPercent(node?.cpu);
  const memoryPercent = utilizationPercent(node?.mem, node?.maxmem);
  const storagePercent = utilizationPercent(node?.disk, node?.maxdisk);

  return (
    <AppShell roles={roles} title="pve1 Lab Metrics">
      <LabStatusCard href={null} status={status} />
      {!snapshot ? (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-4 text-sm text-rose-100">
          No inventory snapshot is available. The monitor must publish a fresh
          report before host metrics can be shown.
        </p>
      ) : null}
      {snapshot && !metricsAvailable ? (
        <p className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
          Availability is live. CPU, memory, storage, uptime, and I/O values
          will appear after the enhanced poller is installed on pve1.
        </p>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          helper={`Latest report from ${snapshot?.source ?? "the lab monitor"}.`}
          label="Host State"
          value={node?.status ?? "Unknown"}
        />
        <MetricCard
          helper={
            node?.maxcpu === undefined
              ? "Logical CPU count not reported."
              : `${node.maxcpu} logical CPUs.`
          }
          label="Host CPU"
          value={cpuUsage}
        />
        <MetricCard
          helper={formatUsage(node?.mem, node?.maxmem)}
          label="Host Memory"
          value={memoryPercent}
        />
        <MetricCard
          helper={formatUsage(node?.disk, node?.maxdisk)}
          label="Host Storage"
          value={storagePercent}
        />
        <MetricCard
          helper={`${resources.length - running} stopped or unavailable.`}
          label="Virtual Machines"
          value={`${running} / ${resources.length}`}
        />
      </section>
      <Card
        eyebrow="pve1 Inventory"
        title={`${resources.length} virtual machines`}
      >
        <div className="table-wrap">
          <table className="data-table whitespace-nowrap">
            <thead>
              <tr>
                <th>VM</th>
                <th>VMID</th>
                <th>Type</th>
                <th>State</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Disk</th>
                <th>Uptime</th>
                <th>Network I/O</th>
                <th>Disk I/O</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <ResourceRow
                  key={resource.id ?? resource.vmid}
                  row={resource}
                />
              ))}
              {!resources.length ? (
                <tr>
                  <td className="text-slate-400" colSpan={10}>
                    No virtual machines were reported for pve1.
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

function ResourceRow({ row }: { row: ProxmoxResourceRow }) {
  const running = row.status === "running";

  return (
    <tr>
      <td className="font-semibold text-slate-100">
        {row.name ?? row.id ?? `VM ${row.vmid ?? "unknown"}`}
      </td>
      <td>{row.vmid ?? "Not reported"}</td>
      <td className="uppercase">{row.type ?? "Not reported"}</td>
      <td>
        <span
          className={`status-pill ${running ? "" : "border-amber-300/30 bg-amber-300/10 text-amber-100"}`}
        >
          {row.status ?? "unknown"}
        </span>
      </td>
      <td>{formatPercent(row.cpu)}</td>
      <td>{formatUsage(row.mem, row.maxmem)}</td>
      <td>{formatUsage(row.disk, row.maxdisk)}</td>
      <td>{formatUptime(row.uptime)}</td>
      <td>{formatIo(row.netin, row.netout, "in", "out")}</td>
      <td>{formatIo(row.diskread, row.diskwrite, "read", "written")}</td>
    </tr>
  );
}

function utilizationPercent(
  used: number | undefined,
  maximum: number | undefined,
) {
  if (used === undefined || maximum === undefined || maximum === 0) {
    return "Not reported";
  }

  return formatPercent(used / maximum);
}

function formatIo(
  first: number | undefined,
  second: number | undefined,
  firstLabel: string,
  secondLabel: string,
) {
  if (first === undefined && second === undefined) {
    return "Not reported";
  }

  return `${formatBytes(first)} ${firstLabel} / ${formatBytes(second)} ${secondLabel}`;
}

function hasMetrics(
  node: ProxmoxNodeRow | undefined,
  resources: ProxmoxResourceRow[],
) {
  return (
    node?.cpu !== undefined ||
    node?.mem !== undefined ||
    resources.some(
      (resource) =>
        resource.cpu !== undefined ||
        resource.mem !== undefined ||
        resource.uptime !== undefined,
    )
  );
}
