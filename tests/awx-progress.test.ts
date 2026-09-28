import { describe, expect, it } from "vitest";

import {
  parseVerifierProgress,
  verifierRowsToSnapshot,
  type VerifierProgressRow,
} from "@/lib/awx-progress";
import { buildCohortStandings } from "@/lib/cohort-progress";

const acPush = {
  family: "AC",
  verifierJobId: 41293,
  verifiedAt: "2026-09-28T15:43:56Z",
  pods: {
    pod01: { "L1.1": { completed: true, reason: "done" } },
    POD02: {
      "L1.1": { completed: false, reason: "still in Finance" },
      "L1.2": { completed: true, reason: null },
    },
  },
};

function row(
  family: string,
  pods: VerifierProgressRow["pods"],
  verifiedAt = "2026-09-28T15:43:56Z",
): VerifierProgressRow {
  return {
    family,
    verifier_job_id: 1,
    verified_at: verifiedAt,
    received_at: verifiedAt,
    pods,
  };
}

describe("parseVerifierProgress", () => {
  it("normalizes pod keys to the tracker's form", () => {
    const parsed = parseVerifierProgress(acPush);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && Object.keys(parsed.payload.pods)).toEqual([
      "pod01",
      "pod02",
    ]);
    expect(parsed.ok && parsed.payload.pods.pod02["L1.2"].reason).toBeNull();
  });

  it("accepts a lowercase family and host-style pod keys", () => {
    const parsed = parseVerifierProgress({
      ...acPush,
      family: " ac ",
      pods: { "POD02-SRV": { "L1.1": { completed: true, reason: null } } },
    });

    expect(parsed.ok && parsed.payload.family).toBe("AC");
    expect(parsed.ok && Object.keys(parsed.payload.pods)).toEqual(["pod02"]);
  });

  it("rejects an unknown control family", () => {
    const parsed = parseVerifierProgress({ ...acPush, family: "ZZ" });

    expect(parsed.ok).toBe(false);
  });

  it("rejects a payload whose pods cannot be matched to a seat", () => {
    const parsed = parseVerifierProgress({
      ...acPush,
      pods: { localhost: { "L1.1": { completed: true, reason: null } } },
    });

    expect(parsed.ok).toBe(false);
  });

  it("rejects a non-boolean result", () => {
    const parsed = parseVerifierProgress({
      ...acPush,
      pods: { pod01: { "L1.1": { completed: "yes", reason: null } } },
    });

    expect(parsed.ok).toBe(false);
  });
});

describe("verifierRowsToSnapshot", () => {
  it("merges the families each verifier pushed into one snapshot", () => {
    const snapshot = verifierRowsToSnapshot(3, [
      row("AC", {
        pod02: {
          "L1.1": { completed: false, reason: "still in Finance" },
          "L1.2": { completed: true, reason: null },
        },
      }),
      row(
        "IA",
        { pod02: { "M2-L1": { completed: true, reason: null } } },
        "2026-09-28T16:10:00Z",
      ),
    ]);

    expect(snapshot?.source).toBe("awx_verifier_push");
    expect(snapshot?.trackerLastRun).toBe("2026-09-28T16:10:00Z");
    expect(snapshot?.courses.AC.labs).toEqual(["L1.1", "L1.2"]);
    expect(snapshot?.courses.IA.name).toBe("Identification & Authentication");
    expect(Object.keys(snapshot?.pods.pod02 ?? {})).toHaveLength(3);
  });

  it("scores identically to a tracker-sourced snapshot", () => {
    const snapshot = verifierRowsToSnapshot(3, [
      row("AC", {
        pod02: {
          "L1.1": { completed: false, reason: "still in Finance" },
          "L1.2": { completed: true, reason: null },
        },
      }),
    ]);

    const [standing] = buildCohortStandings(snapshot, [
      { podName: "Pod02", userId: "u", fullName: "Adjovi", email: null },
    ]);

    expect(standing.completed).toBe(1);
    expect(standing.total).toBe(2);
    expect(standing.status).toBe("in_progress");
    expect(standing.families).toEqual([
      { code: "AC", name: "Access Control", completed: 1, total: 2 },
    ]);
  });

  it("returns null when nothing has been pushed", () => {
    expect(verifierRowsToSnapshot(3, [])).toBeNull();
    expect(verifierRowsToSnapshot(3, [row("AC", {})])).toBeNull();
  });
});
