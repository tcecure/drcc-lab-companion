import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatPercent,
  formatUptime,
  formatUsage,
} from "@/lib/proxmox/metrics";

describe("Proxmox metric formatting", () => {
  it("formats fractional CPU usage as a percentage", () => {
    expect(formatPercent(0.037)).toBe("3.7%");
    expect(formatPercent(0.82)).toBe("82%");
    expect(formatPercent(undefined)).toBe("Not reported");
  });

  it("formats byte totals and capacity usage", () => {
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
    expect(formatUsage(4_294_967_296, 8_589_934_592)).toBe(
      "4.0 GB / 8.0 GB (50%)",
    );
  });

  it("formats uptime for scanning", () => {
    expect(formatUptime(190_800)).toBe("2d 5h");
    expect(formatUptime(5_520)).toBe("1h 32m");
  });
});
