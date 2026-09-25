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

export type LabCredentialReveal = LabCredentialSummary & {
  password: string | null;
  rotationPending: boolean;
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

/** The password the lab currently accepts, or null before the first push. */
function decryptLive(row: LabCredentialRow) {
  if (!row.secret_ciphertext || !row.secret_nonce || !row.secret_tag) {
    return null;
  }

  return decryptSecret({
    secret_ciphertext: row.secret_ciphertext,
    secret_nonce: row.secret_nonce,
    secret_tag: row.secret_tag,
  });
}

/** The staged password a rotation is waiting to push, if there is one. */
function decryptPending(row: LabCredentialRow) {
  if (!row.pending_ciphertext || !row.pending_nonce || !row.pending_tag) {
    return null;
  }

  return decryptSecret({
    secret_ciphertext: row.pending_ciphertext,
    secret_nonce: row.pending_nonce,
    secret_tag: row.pending_tag,
  });
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
 * The password the lab currently accepts for one seat, which is deliberately
 * not the staged one while a rotation is pending: the student keeps working
 * until AWX has applied the new password. Callers are responsible for proving
 * the actor is entitled to this seat: staff through requireManager(), a student
 * through their own cohort assignment.
 */
export async function revealLabCredential(
  seatNumber: number,
  actor: LabCredentialActor,
): Promise<LabCredentialReveal | null> {
  const row = await readCredential(seatNumber);

  if (!row) {
    return null;
  }

  const password = decryptLive(row);

  if (password !== null) {
    await recordCredentialEvent({
      action: "reveal",
      actor,
      seatNumber,
    });
  }

  return {
    ...toSummary(row),
    password,
    rotationPending: row.status === "pending_push",
  };
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
  const now = new Date().toISOString();
  const encrypted = encryptSecret(input.password);
  const slots = input.markPendingPush
    ? {
        pending_ciphertext: encrypted.secret_ciphertext,
        pending_nonce: encrypted.secret_nonce,
        pending_rotated_at: now,
        pending_tag: encrypted.secret_tag,
        pushed_at: existing?.pushed_at ?? null,
        secret_ciphertext: existing?.secret_ciphertext ?? null,
        secret_nonce: existing?.secret_nonce ?? null,
        secret_tag: existing?.secret_tag ?? null,
        status: "pending_push" as const,
      }
    : {
        ...encrypted,
        pending_ciphertext: null,
        pending_nonce: null,
        pending_rotated_at: null,
        pending_tag: null,
        pushed_at: now,
        status: "active" as const,
      };
  const { error } = await supabase.from("lab_pod_credentials").upsert(
    {
      ...slots,
      key_version: 1,
      lab_username: identity.labUsername,
      pod_name: identity.podName,
      rotated_at: now,
      rotated_by: input.actor.userId ?? null,
      seat_number: input.seatNumber,
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

  return (data ?? []).flatMap((row) => {
    const password = decryptPending(row);

    return password === null
      ? []
      : [{ ...toSummary(row), password, rotationPending: true }];
  });
}

export async function markRotationPushed(seatNumbers: number[]) {
  if (!seatNumbers.length) {
    return [];
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lab_pod_credentials")
    .select("*")
    .in("seat_number", seatNumbers)
    .eq("status", "pending_push");

  if (error) {
    throw new Error(error.message);
  }

  const applied: number[] = [];

  for (const row of data ?? []) {
    const promoted = await supabase
      .from("lab_pod_credentials")
      .update({
        pending_ciphertext: null,
        pending_nonce: null,
        pending_rotated_at: null,
        pending_tag: null,
        pushed_at: new Date().toISOString(),
        secret_ciphertext: row.pending_ciphertext,
        secret_nonce: row.pending_nonce,
        secret_tag: row.pending_tag,
        status: "active",
      })
      .eq("seat_number", row.seat_number)
      .eq("status", "pending_push")
      .select("seat_number");

    if (promoted.error) {
      throw new Error(promoted.error.message);
    }

    if (promoted.data?.length) {
      applied.push(row.seat_number);
    }
  }

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
