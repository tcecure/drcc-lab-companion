import { describe, expect, it } from "vitest";

import {
  parsePodProgress,
  podNumberFromPodName,
  summarizeCohortProgress,
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
    expect(parsePodProgress("01", { ...payload, podName: "Pod02" })).toBeNull();
  });

  it("rejects malformed verification timestamps", () => {
    expect(
      parsePodProgress("01", { ...payload, checkedAt: "not-a-date" }),
    ).toBeNull();
    expect(
      parsePodProgress("01", {
        ...payload,
        modules: [{ ...payload.modules[0], completedAt: "yesterday" }],
      }),
    ).toBeNull();
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

describe("summarizeCohortProgress", () => {
  it("summarizes reporting pods without treating outages as zero percent", () => {
    const inProgress = parsePodProgress("01", payload);
    const completed = parsePodProgress("02", {
      ...payload,
      podName: "Pod02",
      studentNumber: "02",
      overallPercentage: 100,
      status: "completed",
    });

    expect(
      summarizeCohortProgress([
        inProgress,
        completed,
        unavailableProgress("03"),
        null,
      ]),
    ).toEqual({
      averagePercentage: 63,
      completed: 1,
      inProgress: 1,
      notStarted: 0,
      unavailable: 2,
    });
  });
});
