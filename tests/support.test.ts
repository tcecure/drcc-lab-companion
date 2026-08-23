import { describe, expect, it } from "vitest";

import { currentLabNotices } from "@/lib/support";

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
});
