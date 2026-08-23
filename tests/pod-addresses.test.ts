import { describe, expect, it } from "vitest";

import { getPodAddresses } from "@/lib/pod-addresses";

describe("getPodAddresses", () => {
  it("uses unpadded numeric octets for single-digit pods", () => {
    expect(getPodAddresses(1)).toEqual({
      gatewayAddress: "10.51.1.1",
      podNetwork: "10.50.1.0/24",
    });
  });

  it("preserves two-digit pod numbers", () => {
    expect(getPodAddresses(12)).toEqual({
      gatewayAddress: "10.51.12.1",
      podNetwork: "10.50.12.0/24",
    });
  });

  it("rejects values outside the 20-seat lab", () => {
    expect(() => getPodAddresses(0)).toThrow(RangeError);
    expect(() => getPodAddresses(21)).toThrow(RangeError);
    expect(() => getPodAddresses(1.5)).toThrow(RangeError);
  });
});
