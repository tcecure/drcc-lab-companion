import "server-only";

import {
  type VerifierProgressPayload,
  type VerifierProgressRow,
  verifierRowsToSnapshot,
} from "@/lib/awx-progress";
import { createAdminClient } from "@/lib/supabase/admin";

/** Overwrites the stored results for one control family with one verifier run. */
export async function recordVerifierProgress(payload: VerifierProgressPayload) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("awx_verifier_progress").upsert(
    {
      family: payload.family,
      verifier_job_id: payload.verifierJobId,
      verified_at: payload.verifiedAt,
      received_at: new Date().toISOString(),
      pods: payload.pods,
    },
    { onConflict: "family" },
  );

  if (error) {
    throw new Error(error.message);
  }

  const pods = Object.keys(payload.pods);

  return {
    family: payload.family,
    pods: pods.length,
    labs: pods.reduce(
      (total, pod) => total + Object.keys(payload.pods[pod] ?? {}).length,
      0,
    ),
  };
}

export async function listVerifierProgress(): Promise<VerifierProgressRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("awx_verifier_progress")
    .select("family, verifier_job_id, verified_at, received_at, pods")
    .order("family", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as VerifierProgressRow[];
}

/**
 * The portal's own view of live results, used when the training tracker cannot
 * be reached. Returns null when no verifier has pushed anything yet.
 */
export async function fetchPushedCohortSnapshot(cohortNumber: number) {
  try {
    return verifierRowsToSnapshot(cohortNumber, await listVerifierProgress());
  } catch {
    return null;
  }
}
