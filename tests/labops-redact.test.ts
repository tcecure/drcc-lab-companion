import { describe, expect, it } from "vitest";

import { containsSecret, redactRecord, redactText } from "@/lib/labops/redact";

describe("LabOps AI credential redaction", () => {
  it("removes provider keys and tokens", () => {
    const samples = [
      "key is sk-proj-abcdefghijklmnopqrstuvwx1234567890",
      "aws AKIAIOSFODNN7EXAMPLE here",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "xoxb-1234567890-abcdefghijkl",
      "sbs_abcdefghijklmnopqrstuvwxyz012345",
    ];

    for (const sample of samples) {
      const result = redactText(sample);
      expect(result.redacted).toBe(true);
      expect(result.text).toContain("[REDACTED:");
    }
  });

  it("redacts assignments, bearer headers and urls with inline credentials", () => {
    const result = redactText(
      [
        'password = "Sup3rSecretLabPass"',
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        "https://admin:pfsense123@10.51.3.1/",
        "postgresql://user:pw@db.internal:5432/labops",
      ].join("\n"),
    );

    expect(result.text).not.toContain("Sup3rSecretLabPass");
    expect(result.text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.text).not.toContain("pfsense123");
    expect(result.text).not.toContain("db.internal");
    expect(result.text).toContain("https://[REDACTED:url_credentials]@10.51.3.1/");
  });

  it("removes private key blocks whole", () => {
    const result = redactText(
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----",
    );

    expect(result.text).toBe("[REDACTED:private_key]");
  });

  it("keeps ordinary troubleshooting text intact", () => {
    const text =
      "Student cannot reach http://10.51.3.1 from POD03-DC; Guacamole shows a black screen after login.";

    const result = redactText(text);

    expect(result.text).toBe(text);
    expect(result.redacted).toBe(false);
    expect(containsSecret(text)).toBe(false);
  });

  it("catches high entropy strings that no named rule matched", () => {
    const result = redactText("blob 9f8a7Bc6d5E4f3a2B1c0d9E8f7a6B5c4d3E2f1a0");

    expect(result.redacted).toBe(true);
    expect(result.redactions.some((entry) => entry.kind === "high_entropy")).toBe(true);
  });

  it("redacts string fields of a record and reports what it found", () => {
    const { record, redactions } = redactRecord({
      finding: "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      exitCode: 1,
    });

    expect(record.finding).not.toContain("ghp_");
    expect(record.exitCode).toBe(1);
    expect(redactions.length).toBeGreaterThan(0);
  });
});
