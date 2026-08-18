export type LabStatusColor = "green" | "yellow" | "red" | "gray";

export type ProxmoxMetrics = {
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
};

export type ProxmoxNodeRow = ProxmoxMetrics & {
  node: string;
  status?: string;
};

export type ProxmoxResourceRow = ProxmoxMetrics & {
  id?: string;
  name?: string;
  node?: string;
  status?: string;
  type?: string;
  vmid?: number;
};

export type LabStatusSnapshot = {
  checkedAt: string;
  nodes: ProxmoxNodeRow[];
  resources: ProxmoxResourceRow[];
  source?: string;
};

export type LabStatusRow = {
  name: string;
  node?: string;
  online: boolean;
  status: string;
};

export type LabStatusPod = {
  pod: string;
  components: LabStatusRow[];
  online: boolean;
};

export type LabStatusExpectations = {
  /** Hypervisor nodes, e.g. "pve1". */
  nodes: string[];
  /** Core domain controllers. These are virtual machines, not Proxmox nodes. */
  coreDCs: string[];
  /** Pod label -> component names or VMIDs. */
  pods: Array<{ pod: string; components: string[] }>;
};

export type LabStatusSummary = {
  checkedAt: string;
  color: LabStatusColor;
  configured: boolean;
  detail: string;
  label: string;
  source: string;
  stale: boolean;
  hosts: LabStatusRow[];
  coreDCs: LabStatusRow[];
  pods: LabStatusPod[];
  /** Exact resources that are stopped, missing, or unreachable. */
  failed: string[];
};

/**
 * Parses `PROXMOX_EXPECTED_PODS`. Pods are separated by `;`, components inside a
 * pod by `,`, and an optional `Label=` prefix names the pod:
 *
 *   "Pod01=Pod01-GW;Pod03=Pod03-GW,POD03-SRV"
 *
 * A plain comma-separated list still works — each entry becomes its own pod:
 *
 *   "Pod01-GW,Pod02-GW"
 */
export function parseExpectedPods(input: string | undefined) {
  const groups = (input ?? "")
    .split(";")
    .map((group) => group.trim())
    .filter(Boolean);

  return groups.flatMap((group) => {
    const [rawLabel, rawComponents] = group.includes("=")
      ? [
          group.slice(0, group.indexOf("=")),
          group.slice(group.indexOf("=") + 1),
        ]
      : [undefined, group];
    const components = rawComponents
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!components.length) {
      return [];
    }

    if (rawLabel?.trim()) {
      return [{ components, pod: rawLabel.trim() }];
    }

    return components.map((component) => ({
      components: [component],
      pod: component,
    }));
  });
}

export function parseList(input: string | undefined) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function findResource(resources: ProxmoxResourceRow[], name: string) {
  const wanted = name.toLowerCase();

  return resources.find(
    (resource) =>
      resource.name?.toLowerCase() === wanted ||
      resource.id?.toLowerCase() === wanted ||
      String(resource.vmid ?? "") === name,
  );
}

function toRow(resources: ProxmoxResourceRow[], name: string): LabStatusRow {
  const found = findResource(resources, name);

  return {
    name,
    node: found?.node,
    online: found?.status === "running",
    status: found?.status ?? "missing",
  };
}

export function unknownStatus(
  expectations: LabStatusExpectations,
  detail: string,
  options: { configured?: boolean; checkedAt?: string; source?: string } = {},
): LabStatusSummary {
  const blank = (name: string): LabStatusRow => ({
    name,
    online: false,
    status: "unknown",
  });

  return {
    checkedAt: options.checkedAt ?? new Date().toISOString(),
    color: "gray",
    configured: options.configured ?? true,
    coreDCs: expectations.coreDCs.map(blank),
    detail,
    failed: [],
    hosts: expectations.nodes.map(blank),
    label: "Unknown",
    pods: expectations.pods.map((pod) => ({
      components: pod.components.map(blank),
      online: false,
      pod: pod.pod,
    })),
    source: options.source ?? "unavailable",
    stale: true,
  };
}

function statusLabel(color: LabStatusColor) {
  if (color === "green") {
    return "Online";
  }

  if (color === "yellow") {
    return "Pods degraded";
  }

  if (color === "red") {
    return "Core DC down";
  }

  return "Unknown";
}

/**
 * Applies the DRCC health rules to a snapshot:
 *
 *   red    — a core DC is stopped or missing (students cannot authenticate)
 *   yellow — core DCs are running, but a pod component is stopped or missing
 *   green  — everything expected is running
 *   gray   — handled by the caller: snapshot unreachable or stale
 *
 * A gray result is never reported as a confirmed outage.
 */
export function summarizeLabStatus(
  snapshot: LabStatusSnapshot,
  expectations: LabStatusExpectations,
): LabStatusSummary {
  const hosts = expectations.nodes.map((name) => {
    const found = snapshot.nodes.find((node) => node.node === name);

    return {
      name,
      online: found?.status === "online",
      status: found?.status ?? "missing",
    };
  });
  const coreDCs = expectations.coreDCs.map((name) =>
    toRow(snapshot.resources, name),
  );
  const pods = expectations.pods.map((pod) => {
    const components = pod.components.map((name) =>
      toRow(snapshot.resources, name),
    );

    return {
      components,
      online: components.every((component) => component.online),
      pod: pod.pod,
    };
  });
  const failedDCs = coreDCs.filter((dc) => !dc.online);
  const failedPodComponents = pods.flatMap((pod) =>
    pod.components.filter((component) => !component.online),
  );
  const failedHosts = hosts.filter((host) => !host.online);
  const color: LabStatusColor = failedDCs.length
    ? "red"
    : failedPodComponents.length || failedHosts.length
      ? "yellow"
      : "green";
  const failed = [...failedDCs, ...failedHosts, ...failedPodComponents].map(
    (row) => `${row.name} (${row.status})`,
  );

  return {
    checkedAt: snapshot.checkedAt,
    color,
    configured: true,
    coreDCs,
    detail: failedDCs.length
      ? `Core domain controller unavailable: ${failed.join(", ")}.`
      : failed.length
        ? `Core domain controllers are running. Needs attention: ${failed.join(", ")}.`
        : "Core domain controllers and all expected pod components are running.",
    failed,
    hosts,
    label: statusLabel(color),
    pods,
    source: snapshot.source ?? "direct-api",
    stale: false,
  };
}
