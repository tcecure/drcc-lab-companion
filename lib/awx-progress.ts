import { z } from "zod";

import type {
  CohortCourse,
  CohortSnapshot,
  LabResult,
} from "@/lib/cohort-progress";
import { podNumberFromPodName } from "@/lib/training-progress";

/**
 * Family codes and names as the training tracker publishes them, so a snapshot
 * assembled here scores identically to one read from the tracker (the standings
 * resolve a lab's family through these course lab lists).
 */
export const verifierFamilyNames: Record<string, string> = {
  AC: "Access Control",
  IA: "Identification & Authentication",
  MP: "Media Protection",
  PE: "Physical Protection",
  SC: "System & Communications Protection",
  SI: "System & Information Integrity",
};

const labResultSchema = z.object({
  completed: z.boolean(),
  reason: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

const payloadSchema = z.object({
  family: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => value in verifierFamilyNames, "Unknown control family."),
  verifierJobId: z.coerce.number().int().min(0).default(0),
  verifiedAt: z.string().datetime(),
  pods: z.record(z.string(), z.record(z.string(), labResultSchema)),
});

export type VerifierProgressPayload = z.infer<typeof payloadSchema>;

export type VerifierProgressRow = {
  family: string;
  verifier_job_id: number;
  verified_at: string;
  received_at: string;
  pods: Record<string, Record<string, LabResult>> | null;
};

/**
 * The verifiers key their results `pod01`..`pod20`, but a play that keys them by
 * host (`POD02-SRV`) is the same pod. Anything else is dropped rather than
 * stored under a key the standings cannot match to a seat.
 */
function normalizePods(pods: VerifierProgressPayload["pods"]) {
  const normalized: Record<string, Record<string, LabResult>> = {};

  for (const [podKey, labs] of Object.entries(pods)) {
    const podNumber = podNumberFromPodName(
      podKey.trim().replace(/-(?:srv|dc)\d*$/i, ""),
    );

    if (podNumber) {
      normalized[`pod${podNumber}`] = labs;
    }
  }

  return normalized;
}

export function parseVerifierProgress(body: unknown) {
  const parsed = payloadSchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Invalid payload.",
    };
  }

  const pods = normalizePods(parsed.data.pods);

  if (Object.keys(pods).length === 0) {
    return { ok: false as const, error: "No recognizable pods in payload." };
  }

  return { ok: true as const, payload: { ...parsed.data, pods } };
}

/**
 * Builds a cohort snapshot out of the stored family rows. Courses are derived
 * from the lab ids each family actually graded, which is what the tracker
 * reports too, so families a verifier has never pushed simply do not appear
 * instead of counting as incomplete.
 */
export function verifierRowsToSnapshot(
  cohortNumber: number,
  rows: VerifierProgressRow[],
): CohortSnapshot | null {
  const courses: Record<string, CohortCourse> = {};
  const pods: CohortSnapshot["pods"] = {};
  let lastVerifiedAt: string | null = null;

  for (const row of rows) {
    const family = row.family.toUpperCase();
    const labIds = new Set<string>();

    for (const [podKey, labs] of Object.entries(row.pods ?? {})) {
      pods[podKey] = { ...(pods[podKey] ?? {}), ...labs };

      for (const labId of Object.keys(labs)) {
        labIds.add(labId);
      }
    }

    if (labIds.size === 0) {
      continue;
    }

    courses[family] = {
      name: verifierFamilyNames[family] ?? family,
      labs: [...labIds].sort(),
    };

    if (!lastVerifiedAt || row.verified_at > lastVerifiedAt) {
      lastVerifiedAt = row.verified_at;
    }
  }

  if (Object.keys(pods).length === 0) {
    return null;
  }

  return {
    cohortNumber,
    status: "live",
    capturedAt: new Date().toISOString(),
    finalizedAt: null,
    source: "awx_verifier_push",
    trackerLastRun: lastVerifiedAt,
    courses,
    pods,
    waivedLabs: [],
    note: null,
  };
}
