import { describe, expect, it } from "vitest";

import {
  buildInvestigationBrief,
  evaluateEligibility,
  isEligibleForInvestigation,
  summarizeAttachments,
  type SupportRequestRow,
} from "@/lib/labops/intake";

function request(overrides: Partial<SupportRequestRow> = {}): SupportRequestRow {
  return {
    id: "req-1",
    user_id: "user-student-03",
    lab_assignment_id: "assign-3",
    category: "connectivity",
    subject: "Cannot reach my firewall",
    description:
      "I cannot open http://10.51.3.1 from POD03-DC. Ping says destination host unreachable.",
    priority: "high",
    status: "open",
    assigned_to: null,
    requester_name: "James Sinclair",
    requester_email: "james.sinclair@example.edu",
    lab_family: "SC",
    pod_name: "Pod03",
    last_message_at: "2026-08-24T12:00:00.000Z",
    created_at: "2026-08-24T12:00:00.000Z",
    updated_at: "2026-08-24T12:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

describe("LabOps AI support request intake", () => {
  it("accepts open, detailed, in-scope requests", () => {
    expect(isEligibleForInvestigation(request())).toBe(true);
  });

  it("rejects closed and resolved requests", () => {
    expect(evaluateEligibility(request({ status: "closed" })).eligible).toBe(false);
    expect(evaluateEligibility(request({ status: "resolved" })).eligible).toBe(false);
    expect(evaluateEligibility(request({ status: "waiting_on_student" })).eligible).toBe(true);
  });

  it("rejects requests with too little detail", () => {
    const decision = evaluateEligibility(request({ description: "broken" }));

    expect(decision.eligible).toBe(false);
    expect(decision.eligible === false && decision.reason).toContain("too little detail");
  });

  it("keeps only troubleshooting fields and never the student identity", () => {
    const brief = buildInvestigationBrief(
      request({
        description:
          "Contact me at james.sinclair@example.edu. pfSense login admin/pfsense123 does not work at 10.51.3.1.",
      }),
      { podLabel: "Pod03" },
    );

    const serialized = JSON.stringify(brief);

    expect(serialized).not.toContain("user-student-03");
    expect(serialized).not.toContain("james.sinclair@example.edu");
    expect(serialized).not.toContain("pfsense123");
    expect(brief.supportRequestId).toBe("req-1");
    expect(brief.podLabel).toBe("Pod03");
    expect(brief.provenance.pii).toContain("email");
    expect(brief.provenance.redactions.length).toBeGreaterThan(0);
  });

  it("wraps the brief as untrusted evidence for the model", () => {
    const brief = buildInvestigationBrief(request());

    expect(brief.prompt).toContain('<untrusted-evidence source="support_request:req-1">');
    expect(brief.prompt).toContain("Category: connectivity");
    expect(brief.prompt).toContain("10.51.3.1");
  });

  it("lists attachments without forwarding their contents", () => {
    const summary = summarizeAttachments([
      { filename: "screen shot.png", contentType: "image/png", byteSize: 1024 },
      { filename: "creds.exe", contentType: "application/x-msdownload", byteSize: 2048 },
      { filename: "huge.pdf", contentType: "application/pdf", byteSize: 20 * 1024 * 1024 },
    ]);

    expect(summary[0]).toBe("screen_shot.png (image/png)");
    expect(summary[1]).toContain("unsupported type");
    expect(summary[2]).toContain("over the 10 MB limit");

    const brief = buildInvestigationBrief(request(), {
      attachments: [{ filename: "screen shot.png", contentType: "image/png", byteSize: 10 }],
    });

    expect(brief.prompt).toContain("contents not provided");
  });
});
