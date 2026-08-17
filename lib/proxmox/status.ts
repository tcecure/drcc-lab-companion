import "server-only";

import { readServerEnv } from "@/lib/env";

export type LabStatusColor = "green" | "yellow" | "red" | "gray";

type ProxmoxNode = {
  node: string;
  status?: string;
};

type ProxmoxResource = {
  id?: string;
  name?: string;
  node?: string;
  status?: string;
  type?: string;
  vmid?: number;
};

export type LabStatusSummary = {
  color: LabStatusColor;
  configured: boolean;
  label: string;
  detail: string;
  nodes: Array<{ name: string; online: boolean; status: string }>;
  pods: Array<{ name: string; online: boolean; status: string; node?: string }>;
  checkedAt: string;
};

function list(input: string | undefined) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function missingConfig(): LabStatusSummary {
  return {
    checkedAt: new Date().toISOString(),
    color: "gray",
    configured: false,
    detail:
      "Add Proxmox status environment variables to enable live lab health.",
    label: "Not configured",
    nodes: [],
    pods: [],
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
    return "DC down";
  }

  return "Unknown";
}

async function proxmoxGet<T>(path: string) {
  const env = readServerEnv();

  if (
    !env.PROXMOX_API_BASE_URL ||
    !env.PROXMOX_API_TOKEN_ID ||
    !env.PROXMOX_API_TOKEN_SECRET
  ) {
    throw new Error("Proxmox API is not configured.");
  }

  const url = new URL(path, env.PROXMOX_API_BASE_URL);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `PVEAPIToken=${env.PROXMOX_API_TOKEN_ID}=${env.PROXMOX_API_TOKEN_SECRET}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Proxmox API returned ${response.status}.`);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

export async function getLabStatus(): Promise<LabStatusSummary> {
  const env = readServerEnv();
  const expectedNodes = list(env.PROXMOX_EXPECTED_NODES);
  const expectedPods = list(env.PROXMOX_EXPECTED_PODS);

  if (
    !env.PROXMOX_API_BASE_URL ||
    !env.PROXMOX_API_TOKEN_ID ||
    !env.PROXMOX_API_TOKEN_SECRET
  ) {
    return missingConfig();
  }

  try {
    const [nodeRows, resources] = await Promise.all([
      proxmoxGet<ProxmoxNode[]>("/api2/json/nodes"),
      proxmoxGet<ProxmoxResource[]>("/api2/json/cluster/resources?type=vm"),
    ]);
    const nodeNames = expectedNodes.length
      ? expectedNodes
      : nodeRows.map((node) => node.node);
    const nodes = nodeNames.map((name) => {
      const found = nodeRows.find((node) => node.node === name);

      return {
        name,
        online: found?.status === "online",
        status: found?.status ?? "missing",
      };
    });
    const pods = expectedPods.map((name) => {
      const found = resources.find(
        (resource) =>
          resource.name === name ||
          resource.id === name ||
          String(resource.vmid ?? "") === name,
      );

      return {
        name,
        node: found?.node,
        online: found?.status === "running",
        status: found?.status ?? "missing",
      };
    });
    const anyNodeDown = nodes.some((node) => !node.online);
    const anyPodDown = pods.some((pod) => !pod.online);
    const color: LabStatusColor = anyNodeDown
      ? "red"
      : anyPodDown
        ? "yellow"
        : "green";

    return {
      checkedAt: new Date().toISOString(),
      color,
      configured: true,
      detail: anyNodeDown
        ? "One or more expected DC nodes are offline or missing."
        : anyPodDown
          ? "Core DC nodes are online, but one or more pods need attention."
          : "Expected DC nodes and pods are online.",
      label: statusLabel(color),
      nodes,
      pods,
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      color: "red",
      configured: true,
      detail:
        error instanceof Error ? error.message : "Proxmox status check failed.",
      label: "Check failed",
      nodes: expectedNodes.map((name) => ({
        name,
        online: false,
        status: "unknown",
      })),
      pods: expectedPods.map((name) => ({
        name,
        online: false,
        status: "unknown",
      })),
    };
  }
}
