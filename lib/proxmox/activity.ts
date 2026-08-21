import type {
  LabStatusSnapshot,
  ProxmoxResourceRow,
} from "@/lib/proxmox/health";

export type PodActivityStatus = "active" | "idle" | "offline" | "unknown";

export type PodActivitySummary = {
  checkedAt: string | null;
  detail: string;
  status: PodActivityStatus;
  windowMinutes: number;
};

type ActivityThresholds = {
  activeCpuSamples: number;
  cpuRatio: number;
  diskBytes: number;
  minimumCoverageRatio: number;
  networkBytes: number;
};

type ActivityOptions = {
  now?: Date;
  staleAfterSeconds?: number;
  thresholds?: Partial<ActivityThresholds>;
  windowMinutes?: number;
};

const defaultThresholds: ActivityThresholds = {
  activeCpuSamples: 3,
  cpuRatio: 0.08,
  diskBytes: 16 * 1024 * 1024,
  minimumCoverageRatio: 0.75,
  networkBytes: 2 * 1024 * 1024,
};

const counterFields = ["netin", "netout", "diskread", "diskwrite"] as const;

function podNumber(value: string | null | undefined) {
  const match = /(?:^|[^a-z0-9])pod[-_\s]?0*(\d{1,2})(?=$|[^0-9])/i.exec(
    value ?? "",
  );

  if (!match) {
    return null;
  }

  const number = Number(match[1]);

  return number >= 1 && number <= 20
    ? String(number).padStart(2, "0")
    : null;
}

function resourcePodNumber(resource: ProxmoxResourceRow) {
  return podNumber(resource.name) ?? podNumber(resource.id);
}

function resourceKey(resource: ProxmoxResourceRow) {
  if (resource.vmid !== undefined) {
    return `${resource.type ?? "vm"}:${resource.vmid}`;
  }

  return (resource.id ?? resource.name ?? "").toLowerCase();
}

function timestamp(snapshot: LabStatusSnapshot) {
  return new Date(snapshot.checkedAt).getTime();
}

function counterDelta(
  latest: ProxmoxResourceRow,
  baseline: ProxmoxResourceRow,
  field: (typeof counterFields)[number],
) {
  const current = latest[field];
  const previous = baseline[field];

  if (
    typeof current !== "number" ||
    typeof previous !== "number" ||
    current < previous
  ) {
    return null;
  }

  return current - previous;
}

function unknown(
  windowMinutes: number,
  detail: string,
  checkedAt: string | null = null,
): PodActivitySummary {
  return { checkedAt, detail, status: "unknown", windowMinutes };
}

export function summarizePodActivity(
  snapshots: LabStatusSnapshot[],
  podName: string,
  options: ActivityOptions = {},
): PodActivitySummary {
  const windowMinutes = options.windowMinutes ?? 15;
  const staleAfterSeconds = options.staleAfterSeconds ?? 180;
  const now = options.now ?? new Date();
  const thresholds = { ...defaultThresholds, ...options.thresholds };
  const wantedPod = podNumber(podName);

  if (!wantedPod) {
    return unknown(windowMinutes, "The assigned pod name is not recognized.");
  }

  const ordered = snapshots
    .filter((snapshot) => Number.isFinite(timestamp(snapshot)))
    .toSorted((left, right) => timestamp(right) - timestamp(left));
  const latest = ordered[0];

  if (!latest) {
    return unknown(windowMinutes, "No activity telemetry has been received.");
  }

  const latestAt = timestamp(latest);
  const ageSeconds = (now.getTime() - latestAt) / 1_000;

  if (ageSeconds > staleAfterSeconds) {
    return unknown(
      windowMinutes,
      "The latest activity telemetry is stale.",
      latest.checkedAt,
    );
  }

  const latestResources = latest.resources.filter(
    (resource) => resourcePodNumber(resource) === wantedPod,
  );

  if (!latestResources.length) {
    return unknown(
      windowMinutes,
      `No Proxmox resources were matched to Pod${wantedPod}.`,
      latest.checkedAt,
    );
  }

  const runningResources = latestResources.filter(
    (resource) => resource.status === "running",
  );

  if (!runningResources.length) {
    return {
      checkedAt: latest.checkedAt,
      detail: `Pod${wantedPod} has no running virtual machines.`,
      status: "offline",
      windowMinutes,
    };
  }

  const windowMs = windowMinutes * 60_000;
  const windowSnapshots = ordered.filter((snapshot) => {
    const checkedAt = timestamp(snapshot);

    return checkedAt <= latestAt && checkedAt >= latestAt - windowMs;
  });
  const baseline = windowSnapshots.at(-1);

  if (!baseline || baseline === latest) {
    return unknown(
      windowMinutes,
      "Collecting the initial activity baseline.",
      latest.checkedAt,
    );
  }

  const baselineResources = new Map(
    baseline.resources
      .filter((resource) => resourcePodNumber(resource) === wantedPod)
      .map((resource) => [resourceKey(resource), resource]),
  );
  let comparableCounters = 0;
  let networkBytes = 0;
  let diskBytes = 0;

  for (const resource of runningResources) {
    const previous = baselineResources.get(resourceKey(resource));

    if (!previous) {
      continue;
    }

    for (const field of counterFields) {
      const delta = counterDelta(resource, previous, field);

      if (delta === null) {
        continue;
      }

      comparableCounters += 1;

      if (field === "netin" || field === "netout") {
        networkBytes += delta;
      } else {
        diskBytes += delta;
      }
    }
  }

  const cpuSummary = windowSnapshots.reduce(
    (summary, snapshot) => {
      const samples = snapshot.resources.filter(
        (resource) =>
          resourcePodNumber(resource) === wantedPod &&
          resource.status === "running" &&
          typeof resource.cpu === "number",
      );

      return {
        activeSamples:
          summary.activeSamples +
          Number(samples.some((resource) => resource.cpu! >= thresholds.cpuRatio)),
        observations: summary.observations + samples.length,
      };
    },
    { activeSamples: 0, observations: 0 },
  );
  const active =
    networkBytes >= thresholds.networkBytes ||
    diskBytes >= thresholds.diskBytes ||
    cpuSummary.activeSamples >= thresholds.activeCpuSamples;

  if (active) {
    return {
      checkedAt: latest.checkedAt,
      detail: `Activity detected during the last ${windowMinutes} minutes.`,
      status: "active",
      windowMinutes,
    };
  }

  const coverageMs = latestAt - timestamp(baseline);

  if (coverageMs < windowMs * thresholds.minimumCoverageRatio) {
    return unknown(
      windowMinutes,
      `Collecting a complete ${windowMinutes}-minute activity baseline.`,
      latest.checkedAt,
    );
  }

  if (!comparableCounters && !cpuSummary.observations) {
    return unknown(
      windowMinutes,
      "Activity counters are not available for this pod.",
      latest.checkedAt,
    );
  }

  return {
    checkedAt: latest.checkedAt,
    detail: `No significant pod activity was detected during the last ${windowMinutes} minutes.`,
    status: "idle",
    windowMinutes,
  };
}
