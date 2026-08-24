import { describe, expect, it } from "vitest";

import {
  currentLabNotices,
  expectedLabBehaviors,
  resolvedLabIssues,
} from "@/lib/support";

describe("student support commands", () => {
  it("does not recommend launching ADUC with plain dsa.msc", () => {
    const commands = currentLabNotices.flatMap(
      (notice) => notice.commands ?? [],
    );

    expect(commands).not.toContain("dsa.msc");
    expect(commands.some((command) => command.includes("RunAsInvoker"))).toBe(
      true,
    );
  });

  it("publishes the complete student-facing issue set", () => {
    expect(currentLabNotices).toHaveLength(8);
    expect(resolvedLabIssues).toHaveLength(8);
    expect(expectedLabBehaviors).toHaveLength(4);
    expect(
      currentLabNotices.some((notice) =>
        notice.title.includes("password does not meet"),
      ),
    ).toBe(true);
    expect(
      currentLabNotices.some((notice) =>
        notice.title.includes("interface assignment Add button"),
      ),
    ).toBe(true);
  });

  it("does not publish staff-only deployment notes", () => {
    const publishedContent = JSON.stringify({
      currentLabNotices,
      expectedLabBehaviors,
      resolvedLabIssues,
    });

    expect(publishedContent).not.toContain("crc-awx-labops");
    expect(publishedContent).not.toContain("mp_media_mount_waived");
    expect(publishedContent).not.toContain("RDS grace period");
    expect(publishedContent).not.toContain("Password: pfsense");
  });
});
