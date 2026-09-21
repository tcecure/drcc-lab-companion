import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderQueueConfirmation,
  renderSeatAssignment,
} from "@/lib/notifications";

const portalUrl = "https://my.digitalrcc.com";
const logoUrl = "https://my.digitalrcc.com/brand/digitalrcc-email-logo.png";

function authTemplate(name: "confirmation" | "invite" | "recovery") {
  return readFileSync(
    join(process.cwd(), `supabase/email-templates/${name}.html`),
    "utf8",
  );
}

describe("student lifecycle email templates", () => {
  it("renders the branded queue confirmation", () => {
    const email = renderQueueConfirmation({
      fullName: "Avery Jordan",
      labStartDate: "October 12, 2026",
      portalUrl,
    });

    expect(email.subject).toBe(
      "You are in the queue for the DigitalRCC Cyber Lab",
    );
    expect(email.html).toContain(logoUrl);
    expect(email.html).toContain("LAB QUEUE");
    expect(email.html).toContain("YOU ARE ON THE LIST");
    expect(email.html).toContain("You are in the queue, Avery Jordan.");
    expect(email.html).toContain("SESSION STARTS");
    expect(email.html).toContain("October 12, 2026");
    expect(email.html).toContain(`${portalUrl}/student/queue`);
    expect(email.html).toContain("support@digitalrcc.com");
    expect(email.text).toContain(
      "Activate your portal account from the invitation email first",
    );
  });

  it("renders the branded seat assignment without a password", () => {
    const email = renderSeatAssignment({
      fullName: "Avery Jordan",
      labStartDate: "October 12, 2026",
      labUsername: "student07",
      podName: "Pod07",
      portalUrl,
    });

    expect(email.subject).toBe("Your DigitalRCC lab access is ready");
    expect(email.html).toContain(logoUrl);
    expect(email.html).toContain("LAB ACCESS");
    expect(email.html).toContain("YOUR POD IS READY");
    expect(email.html).toContain("Your lab access is ready, Avery Jordan.");
    expect(email.html).toContain("Pod07");
    expect(email.html).toContain("student07");
    expect(email.html).toContain(`${portalUrl}/student/start`);
    expect(email.html).toContain("Your lab password is never sent by email.");
    expect(email.html).not.toContain("password07");
  });

  it("escapes student-controlled values in HTML", () => {
    const email = renderQueueConfirmation({
      fullName: "<script>alert(1)</script>",
      labStartDate: "October 12, 2026",
      portalUrl,
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("Supabase authentication email templates", () => {
  it.each([
    [
      "invite",
      "ACCOUNT INVITE",
      "/auth/invite?token_hash={{ .TokenHash }}&amp;type=invite",
    ],
    [
      "recovery",
      "PASSWORD RESET",
      "/auth/recovery?token_hash={{ .TokenHash }}&amp;type=recovery",
    ],
    [
      "confirmation",
      "EMAIL CONFIRMATION",
      "/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email",
    ],
  ] as const)(
    "keeps the %s one-time token behind the portal",
    (name, badge, path) => {
      const template = authTemplate(name);

      expect(template).toContain(logoUrl);
      expect(template).toContain(badge);
      expect(template).toContain(`{{ .SiteURL }}${path}`);
      expect(template).not.toContain(".ConfirmationURL");
      expect(template).toContain("support@digitalrcc.com");
      expect(template).toContain(
        "Digital Resilience Community Clinic · Hands-on cyber",
      );
    },
  );

  it("includes both student and operations invitation copy", () => {
    const template = authTemplate("invite");

    expect(template).toContain('eq .Data.organization "DigitalRCC Operations"');
    expect(template).toContain("operations workspace");
    expect(template).toContain("Lab Companion");
    expect(template).toContain("Activate your DigitalRCC account");
    expect(template).toContain("Create a secure password");
    expect(template).toContain("Open your role-specific workspace");
  });
});
