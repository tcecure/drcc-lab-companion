import { describe, expect, it } from "vitest";

import { getSafeRedirectPath } from "@/lib/redirects";

describe("safe portal redirects", () => {
  it("keeps internal destinations", () => {
    expect(getSafeRedirectPath("/set-password")).toBe("/set-password");
    expect(getSafeRedirectPath("/dashboard?welcome=1")).toBe(
      "/dashboard?welcome=1",
    );
  });

  it("rejects external and malformed destinations", () => {
    expect(getSafeRedirectPath("https://example.com")).toBe("/dashboard");
    expect(getSafeRedirectPath("//example.com/path")).toBe("/dashboard");
    expect(getSafeRedirectPath(null)).toBe("/dashboard");
  });

  it("keeps the LabOps host on its own sign-in page", () => {
    expect(getSafeRedirectPath("/labops", "/login")).toBe("/labops");
    expect(getSafeRedirectPath("https://evil.test/labops", "/login")).toBe(
      "/login",
    );
  });
});
