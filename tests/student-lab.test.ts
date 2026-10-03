import { describe, expect, it } from "vitest";

import { replaceGuideTokens } from "@/lib/digital-guides";
import {
  buildStudentLabIdentity,
  pickStudentAssignment,
} from "@/lib/student-lab";

describe("buildStudentLabIdentity", () => {
  it("points the student at their own member server, not a domain controller", () => {
    const identity = buildStudentLabIdentity(3);

    expect(identity.sessionHost).toBe("POD03-SRV");
    expect(identity.sessionHostAddress).toBe("10.50.3.20");
    expect(identity.domainControllers).toEqual(["DC01-P01", "DC02-P01"]);
    expect(identity.domainName).toBe("acs-p01.local");
    expect(identity.gatewayName).toBe("Pod03-GW");
  });

  it("keeps the existing domain account as the student identity", () => {
    const identity = buildStudentLabIdentity(11);

    expect(identity.labUsername).toBe("student11");
    expect(identity.domainUsername).toBe("student11@acs-p01.local");
  });

  it("resolves guide tokens to the member server", () => {
    const identity = buildStudentLabIdentity(7);
    const rendered = replaceGuideTokens(
      "Open {{sessionHost}} ({{sessionHostAddress}}); AD lives on {{domainControllers}}.",
      identity,
    );

    expect(rendered).toBe(
      "Open POD07-SRV (10.50.7.20); AD lives on DC01-P01 and DC02-P01.",
    );
  });

  it("resolves family artifact paths and unpadded network octets", () => {
    const identity = buildStudentLabIdentity(7);
    const rendered = replaceGuideTokens(
      "{{iaArtifactsPath}}|{{siArtifactsPath}}|10.52.{{podOctet}}.1",
      identity,
    );

    expect(rendered).toBe(
      "C:\\CyberLab\\Pod07\\IA-Artifacts\\|C:\\CyberLab\\Pod07\\SI-Artifacts\\|10.52.7.1",
    );
  });

  it("falls back to placeholders without an identity", () => {
    expect(replaceGuideTokens("{{sessionHost}}", null)).toBe("PODXX-SRV");
  });
});

describe("pickStudentAssignment", () => {
  const row = (
    cohortNumber: number,
    status: string,
    accessStartsAt: string,
  ) => ({
    cohort_number: cohortNumber,
    status: status as "queued" | "notified" | "active" | "completed",
    access_starts_at: accessStartsAt,
  });
  const now = new Date("2026-10-01T12:00:00.000Z");

  it("shows a returning learner their new cohort, not the finished one", () => {
    const picked = pickStudentAssignment(
      [
        row(1, "completed", "2026-08-16T04:00:00.000Z"),
        row(4, "queued", "2026-10-04T04:00:00.000Z"),
      ],
      now,
    );

    expect(picked?.cohort_number).toBe(4);
  });

  it("keeps a student on the cohort they can work in today", () => {
    const picked = pickStudentAssignment(
      [
        row(3, "notified", "2026-09-20T04:00:00.000Z"),
        row(5, "queued", "2026-10-18T04:00:00.000Z"),
      ],
      now,
    );

    expect(picked?.cohort_number).toBe(3);
  });

  it("falls back to the last finished cohort", () => {
    const picked = pickStudentAssignment(
      [row(1, "completed", "2026-08-16T04:00:00.000Z")],
      now,
    );

    expect(picked?.cohort_number).toBe(1);
    expect(pickStudentAssignment([], now)).toBeNull();
  });
});
