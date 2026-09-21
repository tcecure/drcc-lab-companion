import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDigitalGuide, labGuides } from "@/lib/lab-guides";

describe("lab guides", () => {
  it("publishes one guide for every CMMC Level 1 family", () => {
    expect(labGuides.map((guide) => guide.code)).toEqual([
      "AC",
      "IA",
      "SI",
      "SC",
      "MP",
      "PE",
    ]);
  });

  it("maps every guide to a bundled PDF", () => {
    for (const guide of labGuides) {
      expect(guide.guidePath.endsWith(".pdf")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", guide.guidePath))).toBe(
        true,
      );
    }
  });

  it("publishes every family as a versioned digital guide", () => {
    for (const guide of labGuides) {
      expect(getDigitalGuide(guide.code)).toEqual({
        path: `/guides/${guide.code.toLowerCase()}`,
        version: "2026.08.1",
      });
      expect(
        existsSync(
          join(
            process.cwd(),
            `content/guides/${guide.code.toLowerCase()}/2026.08.1/guide.mdx`,
          ),
        ),
      ).toBe(true);
    }
  });
});
