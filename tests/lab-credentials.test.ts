import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  generateLabPassword,
  labCredentialsConfigured,
} from "@/lib/lab-credentials";

const key = randomBytes(32).toString("base64");
let previousKey: string | undefined;

beforeEach(() => {
  previousKey = process.env.LAB_CREDENTIAL_ENCRYPTION_KEY;
  process.env.LAB_CREDENTIAL_ENCRYPTION_KEY = key;
});

afterEach(() => {
  if (previousKey === undefined) {
    delete process.env.LAB_CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.LAB_CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
});

describe("lab credential encryption", () => {
  it("round-trips a password without storing it in the clear", () => {
    const stored = encryptSecret("Harbor-kM4tqW-73");

    expect(stored.secret_ciphertext).not.toContain("Harbor");
    expect(decryptSecret(stored)).toBe("Harbor-kM4tqW-73");
  });

  it("uses a fresh nonce for every write", () => {
    const first = encryptSecret("Harbor-kM4tqW-73");
    const second = encryptSecret("Harbor-kM4tqW-73");

    expect(first.secret_nonce).not.toBe(second.secret_nonce);
    expect(first.secret_ciphertext).not.toBe(second.secret_ciphertext);
  });

  it("refuses tampered ciphertext instead of returning garbage", () => {
    const stored = encryptSecret("Harbor-kM4tqW-73");
    const flipped = Buffer.from(stored.secret_ciphertext, "base64");
    flipped[0] ^= 0xff;

    expect(() =>
      decryptSecret({
        ...stored,
        secret_ciphertext: flipped.toString("base64"),
      }),
    ).toThrow();
  });

  it("refuses a credential written under a different key", () => {
    const stored = encryptSecret("Harbor-kM4tqW-73");
    process.env.LAB_CREDENTIAL_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");

    expect(() => decryptSecret(stored)).toThrow();
  });

  it("fails loudly when the key is missing or the wrong length", () => {
    delete process.env.LAB_CREDENTIAL_ENCRYPTION_KEY;
    expect(labCredentialsConfigured()).toBe(false);
    expect(() => encryptSecret("Harbor-kM4tqW-73")).toThrow(
      /LAB_CREDENTIAL_ENCRYPTION_KEY is not set/,
    );

    process.env.LAB_CREDENTIAL_ENCRYPTION_KEY =
      randomBytes(16).toString("base64");
    expect(() => encryptSecret("Harbor-kM4tqW-73")).toThrow(/32 bytes/);
  });
});

describe("generated lab passwords", () => {
  it("is typeable and free of characters students misread", () => {
    const password = generateLabPassword(2);

    const [, middle] = password.split("-");

    expect(password).toMatch(/^[A-Za-z]+-[A-Za-z2-9]{6}-\d{2}$/);
    expect(middle).not.toMatch(/[0OIl1]/);
  });

  it("never repeats across generations for the same seat", () => {
    const generated = new Set(
      Array.from({ length: 50 }, () => generateLabPassword(2)),
    );

    expect(generated.size).toBe(50);
  });
});
