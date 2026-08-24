import { describe, expect, it } from "vitest";

import { canManage, getDefaultPortalPath, isAdmin } from "@/lib/roles";

describe("portal role routing", () => {
  it("routes admins and approvers to the administration workspace", () => {
    expect(getDefaultPortalPath(["admin"])).toBe("/admin");
    expect(getDefaultPortalPath(["approver"])).toBe("/admin");
    expect(getDefaultPortalPath(["student", "admin"])).toBe("/admin");
  });

  it("routes student-only accounts to the student workspace", () => {
    expect(canManage(["student"])).toBe(false);
    expect(getDefaultPortalPath(["student"])).toBe("/student");
    expect(getDefaultPortalPath([])).toBe("/student");
  });

  it("reserves user administration for admins", () => {
    expect(isAdmin(["admin"])).toBe(true);
    expect(isAdmin(["student", "admin"])).toBe(true);
    expect(isAdmin(["approver"])).toBe(false);
    expect(isAdmin(["student"])).toBe(false);
  });
});
