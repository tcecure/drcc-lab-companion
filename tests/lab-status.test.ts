import { describe, expect, it } from "vitest";

import {
  parseExpectedPods,
  summarizeLabStatus,
  unknownStatus,
  type LabStatusExpectations,
  type LabStatusSnapshot,
} from "@/lib/proxmox/health";

const expectations: LabStatusExpectations = {
  coreDCs: ["DC01", "DC02"],
  nodes: ["pve1"],
  pods: parseExpectedPods("Pod01=Pod01-GW;Pod03=Pod03-GW,POD03-SRV"),
};

function snapshot(
  overrides: Partial<Record<string, string>> = {},
): LabStatusSnapshot {
  const status = (name: string) => overrides[name] ?? "running";

  return {
    checkedAt: "2026-08-18T22:00:00.000Z",
    nodes: [{ node: "pve1", status: overrides.pve1 ?? "online" }],
    resources: [
      { name: "DC01", node: "pve1", status: status("DC01"), vmid: 200 },
      { name: "DC02", node: "pve1", status: status("DC02"), vmid: 221 },
      { name: "Pod01-GW", node: "pve1", status: status("Pod01-GW"), vmid: 300 },
      { name: "Pod03-GW", node: "pve1", status: status("Pod03-GW"), vmid: 302 },
      {
        name: "POD03-SRV",
        node: "pve1",
        status: status("POD03-SRV"),
        vmid: 403,
      },
    ].filter((resource) => overrides[resource.name] !== "absent"),
    source: "internal-poller",
  };
}

describe("parseExpectedPods", () => {
  it("groups components per pod and falls back to one pod per entry", () => {
    expect(parseExpectedPods("Pod03=Pod03-GW,POD03-SRV")).toEqual([
      { components: ["Pod03-GW", "POD03-SRV"], pod: "Pod03" },
    ]);
    expect(parseExpectedPods("Pod01-GW,Pod02-GW")).toEqual([
      { components: ["Pod01-GW"], pod: "Pod01-GW" },
      { components: ["Pod02-GW"], pod: "Pod02-GW" },
    ]);
  });
});

describe("summarizeLabStatus", () => {
  it("is green when both core DCs and every pod component run", () => {
    const summary = summarizeLabStatus(snapshot(), expectations);

    expect(summary.color).toBe("green");
    expect(summary.failed).toEqual([]);
    expect(summary.checkedAt).toBe("2026-08-18T22:00:00.000Z");
  });

  it("is red when a core DC is stopped, even if pods are fine", () => {
    const summary = summarizeLabStatus(
      snapshot({ DC01: "stopped" }),
      expectations,
    );

    expect(summary.color).toBe("red");
    expect(summary.failed).toEqual(["DC01 (stopped)"]);
  });

  it("is red when a core DC is missing from the inventory", () => {
    const summary = summarizeLabStatus(
      snapshot({ DC02: "absent" }),
      expectations,
    );

    expect(summary.color).toBe("red");
    expect(summary.failed).toEqual(["DC02 (missing)"]);
  });

  it("is yellow when a pod component is down but both DCs run", () => {
    const summary = summarizeLabStatus(
      snapshot({ "POD03-SRV": "stopped" }),
      expectations,
    );

    expect(summary.color).toBe("yellow");
    expect(summary.failed).toEqual(["POD03-SRV (stopped)"]);
    expect(summary.pods.find((pod) => pod.pod === "Pod03")?.online).toBe(false);
    expect(summary.pods.find((pod) => pod.pod === "Pod01")?.online).toBe(true);
  });

  it("matches resources by VMID as well as name", () => {
    const summary = summarizeLabStatus(snapshot(), {
      ...expectations,
      coreDCs: ["200", "221"],
    });

    expect(summary.color).toBe("green");
  });
});

describe("unknownStatus", () => {
  it("reports gray without claiming an outage", () => {
    const summary = unknownStatus(expectations, "Proxmox is unreachable.");

    expect(summary.color).toBe("gray");
    expect(summary.label).toBe("Unknown");
    expect(summary.stale).toBe(true);
    expect(summary.failed).toEqual([]);
    expect(summary.coreDCs.map((dc) => dc.status)).toEqual([
      "unknown",
      "unknown",
    ]);
  });
});
