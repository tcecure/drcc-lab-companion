import "server-only";

import { readServerEnv } from "@/lib/env";
import {
  parseExpectedPods,
  parseList,
  summarizeLabStatus,
  unknownStatus,
  type LabStatusExpectations,
  type LabStatusSnapshot,
  type ProxmoxNodeRow,
  type ProxmoxResourceRow,
} from "@/lib/proxmox/health";
import { createAdminClient } from "@/lib/supabase/admin";

export type { LabStatusColor, LabStatusSummary } from "@/lib/proxmox/health";

function expectations(): LabStatusExpectations {
  const env = readServerEnv();

  return {
    coreDCs: parseList(env.PROXMOX_CORE_DC_RESOURCES),
    nodes: parseList(env.PROXMOX_EXPECTED_NODES),
    pods: parseExpectedPods(env.PROXMOX_EXPECTED_PODS),
  };
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
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Proxmox API returned ${response.status}.`);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

async function readSnapshotFromDatabase(): Promise<LabStatusSnapshot | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_status_snapshots")
    .select("checked_at, nodes, resources, source")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    checkedAt: data.checked_at,
    nodes: (data.nodes ?? []) as ProxmoxNodeRow[],
    resources: (data.resources ?? []) as ProxmoxResourceRow[],
    source: data.source ?? "internal-poller",
  };
}

/** Latest normalized inventory snapshot for the admin metrics drill-down. */
export async function getLatestLabSnapshot() {
  try {
    return await readSnapshotFromDatabase();
  } catch {
    return null;
  }
}

/** Rolling telemetry used to estimate whether assigned pods are active or idle. */
export async function getRecentLabSnapshots(windowMinutes = 15) {
  const supabase = createAdminClient();
  const since = new Date(
    Date.now() - (windowMinutes + 2) * 60_000,
  ).toISOString();
  const { data, error } = await supabase
    .from("lab_status_snapshots")
    .select("checked_at, nodes, resources, source")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .limit(64);

  if (error) {
    return [];
  }

  return (data ?? []).map(
    (snapshot): LabStatusSnapshot => ({
      checkedAt: snapshot.checked_at,
      nodes: (snapshot.nodes ?? []) as ProxmoxNodeRow[],
      resources: (snapshot.resources ?? []) as ProxmoxResourceRow[],
      source: snapshot.source ?? "internal-poller",
    }),
  );
}

async function readSnapshotFromProxmox(): Promise<LabStatusSnapshot> {
  const [nodes, resources] = await Promise.all([
    proxmoxGet<ProxmoxNodeRow[]>("/api2/json/nodes"),
    proxmoxGet<ProxmoxResourceRow[]>("/api2/json/cluster/resources?type=vm"),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    nodes,
    resources,
    source: "direct-api",
  };
}

/**
 * Reads lab health. The internal poller is preferred: the Proxmox management
 * interface is not reachable from Vercel and must not be published on the
 * internet, so the lab pushes snapshots to `/api/lab-status/ingest` instead.
 * Direct API polling is only used when this process can reach Proxmox itself
 * (a local developer on the lab network, or a future private tunnel).
 */
export async function getLabStatus() {
  const env = readServerEnv();
  const expected = expectations();
  const hasDirectApi = Boolean(
    env.PROXMOX_API_BASE_URL &&
    env.PROXMOX_API_TOKEN_ID &&
    env.PROXMOX_API_TOKEN_SECRET,
  );

  if (!expected.coreDCs.length && !expected.pods.length) {
    return unknownStatus(
      expected,
      "Add PROXMOX_CORE_DC_RESOURCES and PROXMOX_EXPECTED_PODS to enable live lab health.",
      { configured: false, source: "not-configured" },
    );
  }

  let snapshot: LabStatusSnapshot | null = null;
  let failure: string | null = null;

  try {
    snapshot = await readSnapshotFromDatabase();

    if (!snapshot) {
      failure =
        "No lab health snapshot has been received from the lab poller yet.";
    }
  } catch (error) {
    failure =
      error instanceof Error ? error.message : "Snapshot lookup failed.";
  }

  if (!snapshot && hasDirectApi) {
    try {
      snapshot = await readSnapshotFromProxmox();
      failure = null;
    } catch (error) {
      failure =
        error instanceof Error ? error.message : "Proxmox is unreachable.";
    }
  }

  if (!snapshot) {
    return unknownStatus(
      expected,
      `${failure ?? "Lab health is unavailable."} Status is unknown — this is not a confirmed outage.`,
    );
  }

  const ageSeconds =
    (Date.now() - new Date(snapshot.checkedAt).getTime()) / 1_000;

  if (ageSeconds > env.LAB_STATUS_MAX_AGE_SECONDS) {
    return unknownStatus(
      expected,
      `Last lab health report is ${Math.round(ageSeconds)}s old (limit ${env.LAB_STATUS_MAX_AGE_SECONDS}s). Status is unknown — this is not a confirmed outage.`,
      { checkedAt: snapshot.checkedAt, source: snapshot.source },
    );
  }

  return summarizeLabStatus(snapshot, expected);
}
