import { describe, expect, it } from "vitest";

import {
  parsePodProgress,
  podNumberFromPodName,
  unavailableProgress,
} from "@/lib/training-progress";

const payload = {
  podName: "Pod01",
  studentNumber: "01",
  checkedAt: "2026-08-19T10:46:53.124205Z",
  overallPercentage: 25,
  completedModules: 1,
  totalModules: 6,
  currentModule: "IA",
  status: "in_progress",
  modules: [
    {
      id: "AC",
      title: "Access Control",
      status: "completed",
      percentage: 100,
      completedAt: "2026-08-19T10:46:53.124205Z",
    },
  ],
  trackerUrl: "https://training.status.tcecure.com/pod/01",
};

describe("podNumberFromPodName", () => {
  it("reads the pod number from the assignment pod name", () => {
    expect(podNumberFromPodName("Pod01")).toBe("01");
    expect(podNumberFromPodName("pod 9")).toBe("09");
    expect(podNumberFromPodName("POD-20")).toBe("20");
  });

  it("rejects names outside the pod range or of another shape", () => {
    expect(podNumberFromPodName("Pod00")).toBeNull();
    expect(podNumberFromPodName("Pod21")).toBeNull();
    expect(podNumberFromPodName("Pod01-GW")).toBeNull();
    expect(podNumberFromPodName(null)).toBeNull();
  });
});

describe("parsePodProgress", () => {
  it("accepts a well-formed tracker payload", () => {
    expect(parsePodProgress("01", payload)?.overallPercentage).toBe(25);
  });

  it("rejects a payload describing a different pod", () => {
    expect(parsePodProgress("02", payload)).toBeNull();
  });

  it("rejects out-of-range or non-integer percentages", () => {
    expect(
      parsePodProgress("01", { ...payload, overallPercentage: 140 }),
    ).toBeNull();
    expect(
      parsePodProgress("01", { ...payload, overallPercentage: 12.5 }),
    ).toBeNull();
  });

  it("rejects an unknown status value", () => {
    expect(
      parsePodProgress("01", { ...payload, status: "stalled" }),
    ).toBeNull();
  });
});

describe("unavailableProgress", () => {
  it("reports no progress rather than a zero-percent result", () => {
    const progress = unavailableProgress("01");

    expect(progress.status).toBe("unavailable");
    expect(progress.modules).toEqual([]);
    expect(progress.trackerUrl).toBe(
      "https://training.status.tcecure.com/pod/01",
    );
  });
});
