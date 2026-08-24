import { describe, expect, it } from "vitest";

import {
  authorize,
  canDecideSpecificApproval,
  isPilotOperator,
  type LabOpsIdentity,
} from "@/lib/labops/policy";

const owner = "eddie@digitalrcc.com";

function identity(overrides: Partial<LabOpsIdentity> = {}): LabOpsIdentity {
  return {
    userId: "user-owner",
    email: owner,
    roles: ["admin"],
    ...overrides,
  };
}

describe("LabOps AI authorization", () => {
  it("denies students every capability", () => {
    const student = identity({ userId: "user-student", email: "s@x.com", roles: ["student"] });

    for (const capability of [
      "read_investigations",
      "start_investigation",
      "cancel_investigation",
      "decide_approval",
    ] as const) {
      expect(authorize(capability, student, { ownerEmail: owner }).allowed).toBe(false);
    }
  });

  it("lets staff read but not start investigations during the pilot", () => {
    const analyst = identity({
      userId: "user-analyst",
      email: "analyst@digitalrcc.com",
      roles: ["support_analyst"],
    });

    expect(authorize("read_investigations", analyst, { ownerEmail: owner }).allowed).toBe(true);
    expect(authorize("start_investigation", analyst, { ownerEmail: owner }).allowed).toBe(false);
    expect(authorize("cancel_investigation", analyst, { ownerEmail: owner }).allowed).toBe(false);
  });

  it("allows only the configured pilot operator to start and cancel", () => {
    expect(authorize("start_investigation", identity(), { ownerEmail: owner }).allowed).toBe(true);
    expect(authorize("cancel_investigation", identity(), { ownerEmail: owner }).allowed).toBe(true);
  });

  it("matches the owner email case-insensitively but requires a staff role", () => {
    expect(isPilotOperator(identity({ email: "Eddie@DigitalRCC.com " }), owner)).toBe(true);
    expect(isPilotOperator(identity({ roles: ["student"] }), owner)).toBe(false);
  });

  it("refuses to act when no owner email is configured", () => {
    expect(isPilotOperator(identity(), null)).toBe(false);
    expect(isPilotOperator(identity({ email: null }), owner)).toBe(false);
    expect(authorize("start_investigation", identity(), {}).allowed).toBe(false);
  });

  it("blocks self-approval", () => {
    const approver = identity({ userId: "user-approver", email: "a@digitalrcc.com", roles: ["approver"] });

    expect(canDecideSpecificApproval(approver, { requestedBy: "user-owner" }).allowed).toBe(true);
    expect(canDecideSpecificApproval(approver, { requestedBy: "user-approver" }).allowed).toBe(false);
  });

  it("does not let a developer decide approvals", () => {
    const developer = identity({ email: "dev@digitalrcc.com", roles: ["developer"] });

    expect(authorize("decide_approval", developer).allowed).toBe(false);
    expect(authorize("read_investigations", developer).allowed).toBe(true);
  });
});
