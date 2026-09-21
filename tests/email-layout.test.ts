import { describe, expect, it } from "vitest";

import {
  renderQueueConfirmation,
  renderSeatAssignment,
} from "@/lib/notifications";

describe("branded portal email", () => {
  const seat = renderSeatAssignment({
    fullName: "Emma Manjo",
    labStartDate: "Sunday, September 20, 2026",
    labUsername: "student01",
    podName: "Pod01",
    portalUrl: "https://my.digitalrcc.com",
  });

  it("renders a full HTML document with the pod details and call to action", () => {
    expect(seat.html.startsWith("<!doctype html>")).toBe(true);
    expect(seat.html).toContain("Pod01");
    expect(seat.html).toContain("student01");
    expect(seat.html).toContain("https://my.digitalrcc.com/student/start");
    expect(seat.html).toContain("support@digitalrcc.com");
  });

  it("keeps a plain-text alternative carrying the same facts", () => {
    expect(seat.text).toContain("Pod: Pod01");
    expect(seat.text).toContain("Lab username: student01");
    expect(seat.text).toContain("https://my.digitalrcc.com/student/start");
    expect(seat.text).not.toContain("<");
  });

  it("never promises a password by email", () => {
    expect(seat.text).toContain("never sent by email");
  });

  it("escapes student-supplied names", () => {
    const queued = renderQueueConfirmation({
      fullName: '<script>alert("x")</script>',
      labStartDate: "Sunday, September 20, 2026",
      portalUrl: "https://my.digitalrcc.com",
    });

    expect(queued.html).not.toContain("<script>");
    expect(queued.html).toContain("&lt;script&gt;");
  });
});
