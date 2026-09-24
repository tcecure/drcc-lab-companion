import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from "node:crypto";

import { buildStudentLabIdentity } from "@/lib/student-lab";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";

export type LabCredentialRow =
  Database["public"]["Tables"]["lab_pod_credentials"]["Row"];

export type LabCredentialEvent =
  Database["public"]["Tables"]["lab_credential_events"]["Row"];

export type LabCredentialSummary = {
  keyVersion: number;
  labUsername: string;
  podName: string;
  pushedAt: string | null;
  rotatedAt: string;
  seatNumber: number;
  status: LabCredentialRow["status"];
};

export type LabCredentialActor = {
  role: "student" | "staff" | "integration";
  userId?: string | null;
};

const algorithm = "aes-256-gcm";
const nonceBytes = 12;

/**
 * Words plus digits rather than raw base64: a student types this into a
 * Guacamole form and reads it off a screen, and ambiguous characters cost us
 * support tickets. 20 words x 6 random alphanumerics x 2 digits is ~44 bits of
 * entropy in the random part alone, which is well beyond what a lab account
 * facing only the pod network needs.
 */
const passwordWords = [
  "Harbor",
  "Canyon",
  "Lantern",
  "Quartz",
  "Meadow",
  "Falcon",
  "Cobalt",
  "Juniper",
  "Summit",
  "Ember",
  "Willow",
  "Basalt",
  "Orchid",
  "Pioneer",
  "Thistle",
  "Vantage",
  "Cedar",
  "Mosaic",
  "Beacon",
  "Drift",
];

const passwordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generateLabPassword(seatNumber: number) {
  const word = passwordWords[(seatNumber - 1) % passwordWords.length];
  const middle = Array.from(
    { length: 6 },
    () => passwordAlphabet[randomInt(passwordAlphabet.length)],
  ).join("");

  return `${word}-${middle}-${randomInt(10)}${randomInt(10)}`;
}

function readKey() {
  const configured = process.env.LAB_CREDENTIAL_ENCRYPTION_KEY?.trim();

  if (!configured) {
    throw new Error(
      "LAB_CREDENTIAL_ENCRYPTION_KEY is not set, so lab credentials cannot be read or written.",
    );
  }

  const key = Buffer.from(configured, "base64");

  if (key.length !== 32) {
    throw new Error(
      "LAB_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64.",
    );
  }

  return key;
}

export function encryptSecret(plaintext: string) {
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv(algorithm, readKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    secret_ciphertext: ciphertext.toString("base64"),
    secret_nonce: nonce.toString("base64"),
    secret_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(row: {
  secret_ciphertext: string;
  secret_nonce: string;
  secret_tag: string;
}) {
  const decipher = createDecipheriv(
    algorithm,
    readKey(),
    Buffer.from(row.secret_nonce, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.secret_tag, "base64"));

  return (
    decipher.update(Buffer.from(row.secret_ciphertext, "base64")).toString() +
    decipher.final("utf8")
  );
}

export function labCredentialsConfigured() {
  return Boolean(process.env.LAB_CREDENTIAL_ENCRYPTION_KEY?.trim());
}

function toSummary(row: LabCredentialRow): LabCredentialSummary {
  return {
    keyVersion: row.key_version,
    labUsername: row.lab_username,
    podName: row.pod_name,
    pushedAt: row.pushed_at,
    rotatedAt: row.rotated_at,
    seatNumber: row.seat_number,
    status: row.status,
  };
}

export async function recordCredentialEvent(input: {
  action: LabCredentialEvent["action"];
  actor: LabCredentialActor;
  detail?: string;
  seatNumber: number;
}) {
  const supabase = createAdminClient();
  await supabase.from("lab_credential_events").insert({
    action: input.action,
    actor_role: input.actor.role,
    actor_user_id: input.actor.userId ?? null,
    detail: input.detail ?? null,
    seat_number: input.seatNumber,
  });
}

export async function listLabCredentials() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_pod_credentials")
    .select("*")
    .order("seat_number");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toSummary);
}

export async function listCredentialEvents(limit = 40) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_credential_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function readCredential(seatNumber: number) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_pod_credentials")
    .select("*")
    .eq("seat_number", seatNumber)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

/**
 * The plaintext password for one seat, with the access recorded. Callers are
 * responsible for proving the actor is entitled to this seat: staff through
 * requireManager(), a student through their own cohort assignment.
 */
export async function revealLabCredential(
  seatNumber: number,
  actor: LabCredentialActor,
) {
  const row = await readCredential(seatNumber);

  if (!row) {
    return null;
  }

  const password = decryptSecret(row);
  await recordCredentialEvent({
    action: "reveal",
    actor,
    seatNumber,
  });

  return { ...toSummary(row), password };
}

export async function storeLabCredential(input: {
  actor: LabCredentialActor;
  markPendingPush: boolean;
  password: string;
  seatNumber: number;
}) {
  const identity = buildStudentLabIdentity(input.seatNumber);
  const supabase = createAdminClient();
  const existing = await readCredential(input.seatNumber);
  const { error } = await supabase.from("lab_pod_credentials").upsert(
    {
      ...encryptSecret(input.password),
      key_version: 1,
      lab_username: identity.labUsername,
      pod_name: identity.podName,
      pushed_at: input.markPendingPush ? null : new Date().toISOString(),
      rotated_at: new Date().toISOString(),
      rotated_by: input.actor.userId ?? null,
      seat_number: input.seatNumber,
      status: input.markPendingPush ? "pending_push" : "active",
    },
    { onConflict: "seat_number" },
  );

  if (error) {
    throw new Error(error.message);
  }

  await recordCredentialEvent({
    action: existing ? "rotate" : "store",
    actor: input.actor,
    detail: input.markPendingPush
      ? "awaiting push to AD and Guacamole"
      : "recorded as already applied in the lab",
    seatNumber: input.seatNumber,
  });
}

/**
 * Generate the next password for a seat and hold it as pending_push. The lab
 * itself is changed by the AWX bridge, which pulls the pending rotations and
 * acknowledges them; nothing here can reach AD or Guacamole.
 */
export async function rotateLabCredential(input: {
  actor: LabCredentialActor;
  seatNumber: number;
}) {
  const password = generateLabPassword(input.seatNumber);
  await storeLabCredential({
    actor: input.actor,
    markPendingPush: true,
    password,
    seatNumber: input.seatNumber,
  });

  return password;
}

/** Pending rotations handed to the AWX bridge, with plaintext. */
export async function listPendingRotations() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_pod_credentials")
    .select("*")
    .eq("status", "pending_push")
    .order("seat_number");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    ...toSummary(row),
    password: decryptSecret(row),
  }));
}

export async function markRotationPushed(seatNumbers: number[]) {
  if (!seatNumbers.length) {
    return [];
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_pod_credentials")
    .update({ pushed_at: new Date().toISOString(), status: "active" })
    .in("seat_number", seatNumbers)
    .eq("status", "pending_push")
    .select("seat_number");

  if (error) {
    throw new Error(error.message);
  }

  const applied = (data ?? []).map((row) => row.seat_number);

  for (const seatNumber of applied) {
    await recordCredentialEvent({
      action: "push",
      actor: { role: "integration" },
      detail: "applied to AD and Guacamole",
      seatNumber,
    });
  }

  return applied;
}
