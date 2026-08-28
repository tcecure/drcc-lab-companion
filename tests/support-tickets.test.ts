import { describe, expect, it } from "vitest";

import {
  getSupportCategoryLabel,
  getSupportStatusLabel,
  getTicketCode,
  isAllowedSupportImage,
  sanitizeSupportFileName,
} from "@/lib/support-tickets";

describe("support ticket display helpers", () => {
  it("creates a stable public-facing ticket code", () => {
    expect(getTicketCode("12345678-abcd-4000-9000-1234567890ab")).toBe(
      "DRCC-12345678",
    );
  });

  it("uses student-facing category and status labels", () => {
    expect(getSupportCategoryLabel("account_access")).toBe("Account access");
    expect(getSupportCategoryLabel("course_platform")).toBe("Course platform");
    expect(getSupportStatusLabel("waiting_on_student")).toBe(
      "Waiting on student",
    );
  });

  it("sanitizes screenshot names and limits supported content types", () => {
    expect(sanitizeSupportFileName("Pod 01 / error screen.png")).toBe(
      "Pod-01-error-screen.png",
    );
    expect(isAllowedSupportImage("image/png")).toBe(true);
    expect(isAllowedSupportImage("image/svg+xml")).toBe(false);
    expect(isAllowedSupportImage("text/html")).toBe(false);
  });
});
