import { describe, expect, it } from "vitest";

import { replaceGuideTokens } from "@/lib/digital-guides";
import { buildStudentLabIdentity } from "@/lib/student-lab";

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

  it("falls back to placeholders without an identity", () => {
    expect(replaceGuideTokens("{{sessionHost}}", null)).toBe("PODXX-SRV");
  });
});
