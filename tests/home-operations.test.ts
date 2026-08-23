import { describe, expect, it } from "vitest";

import { calculateFilledCapacitySegments } from "@/components/home-operations";

describe("calculateFilledCapacitySegments", () => {
  it("uses the 20 segments as a proportional capacity meter", () => {
    expect(calculateFilledCapacitySegments(12, 20)).toBe(12);
    expect(calculateFilledCapacitySegments(120, 200)).toBe(12);
  });

  it("clamps the meter to its valid range", () => {
    expect(calculateFilledCapacitySegments(250, 200)).toBe(20);
    expect(calculateFilledCapacitySegments(-1, 20)).toBe(0);
  });
});
