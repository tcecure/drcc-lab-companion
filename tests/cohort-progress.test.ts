import { describe, expect, it } from "vitest";

import {
  buildCohortStandings,
  summarizeStandings,
  trackerStatusToSnapshot,
  type CohortSnapshot,
} from "@/lib/cohort-progress";

const trackerStatus = {
  last_run: "2026-08-31T23:41:23.235898Z",
  courses: {
    AC: { name: "Access Control", labs: ["L1.1", "L1.2"] },
    IA: { name: "Identification & Authentication", labs: ["M1-L1", "M3-L2"] },
  },
  pods: {
    POD01: {
      "L1.1": { completed: true, reason: "done" },
      "L1.2": { completed: true, reason: "done" },
      "M1-L1": { completed: true, reason: "done" },
      "M3-L2": { completed: true, reason: "domain policy" },
    },
    pod02: {
      "L1.1": { completed: false, reason: "still in Finance" },
      "L1.2": { completed: false, reason: "still in Finance" },
      "M1-L1": { completed: false, reason: "not attempted" },
      "M3-L2": { completed: true, reason: "domain policy" },
    },
  },
};

const roster = [
  {
    podName: "Pod01",
    userId: "user-1",
    fullName: "James Sinclair",
    email: "james@example.com",
  },
  {
    podName: "Pod02",
    userId: "user-2",
    fullName: "Cecilia Okafor",
    email: "cecilia@example.com",
  },
];

function snapshotOf(waivedLabs: string[] = []): CohortSnapshot {
  const snapshot = trackerStatusToSnapshot(1, trackerStatus, { waivedLabs });

  if (!snapshot) {
    throw new Error("fixture should parse");
  }

  return snapshot;
}

describe("trackerStatusToSnapshot", () => {
  it("normalizes pod keys and keeps the tracker verification time", () => {
    const snapshot = snapshotOf();

    expect(Object.keys(snapshot.pods).sort()).toEqual(["pod01", "pod02"]);
    expect(snapshot.trackerLastRun).toBe("2026-08-31T23:41:23.235898Z");
    expect(snapshot.status).toBe("live");
  });

  it("rejects a payload the tracker reported an error for, or with no pods", () => {
    expect(
      trackerStatusToSnapshot(1, { ...trackerStatus, error: "verify failed" }),
    ).toBeNull();
    expect(
      trackerStatusToSnapshot(1, { ...trackerStatus, pods: {} }),
    ).toBeNull();
    expect(trackerStatusToSnapshot(1, { pods: { pod01: {} } })).toBeNull();
  });
});

describe("buildCohortStandings", () => {
  it("scores each rostered pod per family and ranks by labs completed", () => {
    const rows = buildCohortStandings(snapshotOf(), roster);

    expect(rows.map((row) => row.podName)).toEqual(["Pod01", "Pod02"]);
    expect(rows[0]).toMatchObject({
      completed: 4,
      total: 4,
      status: "completed",
      fullName: "James Sinclair",
    });
    expect(rows[0].families).toEqual([
      { code: "AC", name: "Access Control", completed: 2, total: 2 },
      {
        code: "IA",
        name: "Identification & Authentication",
        completed: 2,
        total: 2,
      },
    ]);
    expect(rows[1]).toMatchObject({ completed: 1, total: 4 });
  });

  it("excludes waived labs so an untouched pod reads zero", () => {
    const rows = buildCohortStandings(snapshotOf(["M3-L2"]), roster);

    expect(rows[0]).toMatchObject({ completed: 3, total: 3 });
    expect(rows[1]).toMatchObject({
      completed: 0,
      total: 3,
      status: "not_started",
    });
    expect(
      rows[1].incompleteLabs.map((lab) => `${lab.code} ${lab.labId}`),
    ).toEqual(["AC L1.1", "AC L1.2", "IA M1-L1"]);
  });

  it("reports pods with no snapshot data instead of scoring them zero", () => {
    const rows = buildCohortStandings(snapshotOf(), [
      { podName: "Pod07", userId: "user-7", fullName: null, email: null },
    ]);

    expect(rows[0]).toMatchObject({ status: "unavailable", total: 0 });
    expect(buildCohortStandings(null, roster)[0].status).toBe("unavailable");
  });

  it("ignores roster rows without a usable pod name", () => {
    expect(
      buildCohortStandings(snapshotOf(), [
        { podName: null, userId: "queued", fullName: null, email: null },
        { podName: "Pod21", userId: "bad", fullName: null, email: null },
      ]),
    ).toEqual([]);
  });
});

describe("summarizeStandings", () => {
  it("counts outcomes and labs across the cohort", () => {
    expect(
      summarizeStandings(buildCohortStandings(snapshotOf(["M3-L2"]), roster)),
    ).toEqual({
      students: 2,
      completedAll: 1,
      inProgress: 0,
      notStarted: 1,
      labsCompleted: 3,
      labsTotal: 6,
    });
  });
});
