import { describe, expect, it } from "vitest";

import { summarizePodActivity } from "@/lib/proxmox/activity";
import type { LabStatusSnapshot } from "@/lib/proxmox/health";

const now = new Date("2026-08-20T14:00:00.000Z");

function snapshot(
  minutesAgo: number,
  overrides: Record<string, unknown> = {},
): LabStatusSnapshot {
  return {
    checkedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    nodes: [],
    resources: [
      {
        cpu: 0.01,
        diskread: 1_000,
        diskwrite: 1_000,
        name: "POD11-SRV",
        netin: 1_000,
        netout: 1_000,
        status: "running",
        type: "qemu",
        uptime: 3_600,
        vmid: 411,
        ...overrides,
      },
    ],
    source: "test",
  };
}

describe("summarizePodActivity", () => {
  it("reports active when network counters move meaningfully", () => {
    const result = summarizePodActivity(
      [snapshot(0, { netin: 3_000_000 }), snapshot(15)],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("active");
  });

  it("reports idle after a complete quiet window", () => {
    const result = summarizePodActivity(
      [snapshot(0), snapshot(8), snapshot(15)],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("idle");
  });

  it("reports active after sustained CPU activity", () => {
    const result = summarizePodActivity(
      [
        snapshot(0, { cpu: 0.12 }),
        snapshot(5, { cpu: 0.09 }),
        snapshot(10, { cpu: 0.1 }),
        snapshot(15),
      ],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("active");
  });

  it("reports offline when the pod has no running resources", () => {
    const result = summarizePodActivity(
      [snapshot(0, { status: "stopped" }), snapshot(15)],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("offline");
  });

  it("reports unknown when telemetry is stale", () => {
    const result = summarizePodActivity([snapshot(10)], "Pod11", { now });

    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("stale");
  });

  it("waits for a complete baseline before reporting idle", () => {
    const result = summarizePodActivity(
      [snapshot(0), snapshot(4)],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("complete");
  });

  it("reports unknown when no activity counters are available", () => {
    const withoutMetrics = {
      cpu: undefined,
      diskread: undefined,
      diskwrite: undefined,
      netin: undefined,
      netout: undefined,
    };
    const result = summarizePodActivity(
      [snapshot(0, withoutMetrics), snapshot(15, withoutMetrics)],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("not available");
  });

  it("matches prefixed Proxmox pod names", () => {
    const result = summarizePodActivity(
      [
        snapshot(0, { name: "CMMC-L1-POD-11", netout: 4_000_000 }),
        snapshot(15, { name: "CMMC-L1-POD-11" }),
      ],
      "Pod11",
      { now },
    );

    expect(result.status).toBe("active");
  });
});
