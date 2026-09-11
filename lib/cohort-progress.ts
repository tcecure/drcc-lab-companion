import "server-only";

import { z } from "zod";

import { getCohortSchedule, getCurrentCohortNumber } from "@/lib/cohorts";
import { readServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { podNumberFromPodName } from "@/lib/training-progress";

const defaultTrackerBaseUrl = "https://training.status.tcecure.com";

const labResultSchema = z.object({
  completed: z.boolean(),
  reason: z.string().nullable().default(null),
});

const courseSchema = z.object({
  name: z.string().min(1),
  labs: z.array(z.string().min(1)).default([]),
});

/** Shape of the tracker's own status endpoint (`/api/training-status`). */
const trackerStatusSchema = z.object({
  pods: z.record(z.string(), z.record(z.string(), labResultSchema)),
  courses: z.record(z.string(), courseSchema),
  last_run: z.string().nullable().default(null),
  error: z.string().nullable().optional(),
});

export type LabResult = z.infer<typeof labResultSchema>;
export type CohortCourse = z.infer<typeof courseSchema>;

export type CohortSnapshot = {
  cohortNumber: number;
  status: "live" | "interim" | "final";
  capturedAt: string;
  finalizedAt: string | null;
  source: string;
  trackerLastRun: string | null;
  courses: Record<string, CohortCourse>;
  pods: Record<string, Record<string, LabResult>>;
  waivedLabs: string[];
  note: string | null;
};

export type FamilyScore = {
  code: string;
  name: string;
  completed: number;
  total: number;
};

export type StandingStatus =
  "completed" | "in_progress" | "not_started" | "unavailable";

export type StandingRow = {
  podNumber: string;
  podName: string;
  userId: string | null;
  fullName: string | null;
  email: string | null;
  status: StandingStatus;
  completed: number;
  total: number;
  families: FamilyScore[];
  incompleteLabs: { code: string; labId: string; reason: string | null }[];
};

export type RosterEntry = {
  podName: string | null;
  userId: string | null;
  fullName: string | null;
  email: string | null;
};

function trackerBaseUrl(baseUrl?: string) {
  return (baseUrl ?? defaultTrackerBaseUrl).replace(/\/+$/, "");
}

/** Normalizes a tracker payload into the snapshot shape we persist. */
export function trackerStatusToSnapshot(
  cohortNumber: number,
  body: unknown,
  options: {
    capturedAt?: string;
    status?: CohortSnapshot["status"];
    waivedLabs?: string[];
  } = {},
): CohortSnapshot | null {
  const parsed = trackerStatusSchema.safeParse(body);

  if (!parsed.success || parsed.data.error) {
    return null;
  }

  const pods: CohortSnapshot["pods"] = {};

  for (const [podKey, labs] of Object.entries(parsed.data.pods)) {
    const podNumber = podNumberFromPodName(podKey);

    if (podNumber) {
      pods[`pod${podNumber}`] = labs;
    }
  }

  if (Object.keys(pods).length === 0) {
    return null;
  }

  return {
    cohortNumber,
    status: options.status ?? "live",
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    finalizedAt: null,
    source: "training_tracker",
    trackerLastRun: parsed.data.last_run,
    courses: parsed.data.courses,
    pods,
    waivedLabs: options.waivedLabs ?? [],
    note: null,
  };
}

/** Reads the live tracker status. Returns null when it cannot be reached. */
export async function fetchLiveCohortSnapshot(
  cohortNumber: number,
  baseUrl?: string,
): Promise<CohortSnapshot | null> {
  const env = readServerEnv();
  const url = new URL(
    "/api/training-status",
    `${trackerBaseUrl(baseUrl ?? env.TRAINING_TRACKER_BASE_URL)}/`,
  );

  try {
    const response = await fetch(url, {
      next: { revalidate: 45 },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return null;
    }

    return trackerStatusToSnapshot(cohortNumber, await response.json());
  } catch {
    return null;
  }
}

type SnapshotRow = {
  cohort_number: number;
  status: "interim" | "final";
  captured_at: string;
  finalized_at: string | null;
  source: string;
  tracker_last_run: string | null;
  courses: Record<string, CohortCourse> | null;
  pods: Record<string, Record<string, LabResult>> | null;
  waived_labs: string[] | null;
  note: string | null;
};

function rowToSnapshot(row: SnapshotRow): CohortSnapshot {
  return {
    cohortNumber: row.cohort_number,
    status: row.status,
    capturedAt: row.captured_at,
    finalizedAt: row.finalized_at,
    source: row.source,
    trackerLastRun: row.tracker_last_run,
    courses: row.courses ?? {},
    pods: row.pods ?? {},
    waivedLabs: row.waived_labs ?? [],
    note: row.note,
  };
}

export async function getStoredCohortSnapshot(cohortNumber: number) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cohort_progress_snapshots")
    .select("*")
    .eq("cohort_number", cohortNumber)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? rowToSnapshot(data as SnapshotRow) : null;
}

export async function listStoredCohortSnapshots() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cohort_progress_snapshots")
    .select("cohort_number, status, captured_at, finalized_at")
    .order("cohort_number", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

/**
 * Captures the live tracker into the current cohort's snapshot and freezes the
 * snapshot of any cohort whose access window has closed. Safe to run on a
 * schedule: a 'final' row is never rewritten, so a frozen cohort keeps the
 * standings it had while its students were in the pods.
 */
export async function captureCohortSnapshots(now = new Date()) {
  const supabase = createAdminClient();
  const stored = await listStoredCohortSnapshots();
  const finalized: number[] = [];

  for (const row of stored) {
    if (
      row.status === "final" ||
      new Date(getCohortSchedule(row.cohort_number).accessEndsAt) > now
    ) {
      continue;
    }

    const { error } = await supabase
      .from("cohort_progress_snapshots")
      .update({ status: "final", finalized_at: now.toISOString() })
      .eq("cohort_number", row.cohort_number)
      .eq("status", "interim");

    if (error) {
      throw new Error(error.message);
    }

    finalized.push(row.cohort_number);
  }

  const cohortNumber = getCurrentCohortNumber(now);

  if (!cohortNumber) {
    return { finalized, captured: null, reason: "no_active_cohort" as const };
  }

  const snapshot = await fetchLiveCohortSnapshot(cohortNumber);

  if (!snapshot) {
    return {
      finalized,
      captured: null,
      reason: "tracker_unavailable" as const,
    };
  }

  const existing = stored.find((row) => row.cohort_number === cohortNumber);

  if (existing?.status === "final") {
    return { finalized, captured: null, reason: "already_final" as const };
  }

  const { error } = await supabase.from("cohort_progress_snapshots").upsert(
    {
      cohort_number: cohortNumber,
      status: "interim",
      captured_at: now.toISOString(),
      source: snapshot.source,
      tracker_last_run: snapshot.trackerLastRun,
      courses: snapshot.courses,
      pods: snapshot.pods,
    },
    { onConflict: "cohort_number" },
  );

  if (error) {
    throw new Error(error.message);
  }

  return { finalized, captured: cohortNumber, reason: "captured" as const };
}

function familyOfLab(courses: Record<string, CohortCourse>, labId: string) {
  for (const [code, course] of Object.entries(courses)) {
    if (course.labs.includes(labId)) {
      return code;
    }
  }

  return null;
}

/**
 * Scores every pod in the snapshot against the cohort roster. Waived labs are
 * left out of both numerator and denominator so a pod nobody touched reads
 * 0 instead of inheriting a free pass.
 */
export function buildCohortStandings(
  snapshot: CohortSnapshot | null,
  roster: RosterEntry[],
): StandingRow[] {
  const waived = new Set(snapshot?.waivedLabs ?? []);
  const courses = snapshot?.courses ?? {};
  const rows: StandingRow[] = [];

  for (const entry of roster) {
    const podNumber = podNumberFromPodName(entry.podName);

    if (!podNumber) {
      continue;
    }

    const labs = snapshot?.pods[`pod${podNumber}`] ?? null;
    const byFamily = new Map<string, FamilyScore>();
    const incompleteLabs: StandingRow["incompleteLabs"] = [];
    let completed = 0;
    let total = 0;

    for (const [labId, result] of Object.entries(labs ?? {})) {
      if (waived.has(labId)) {
        continue;
      }

      const code = familyOfLab(courses, labId) ?? "other";
      const family = byFamily.get(code) ?? {
        code,
        name: courses[code]?.name ?? code,
        completed: 0,
        total: 0,
      };

      family.total += 1;
      total += 1;

      if (result.completed) {
        family.completed += 1;
        completed += 1;
      } else {
        incompleteLabs.push({ code, labId, reason: result.reason });
      }

      byFamily.set(code, family);
    }

    const order = Object.keys(courses);
    const families = [...byFamily.values()].sort(
      (left, right) => order.indexOf(left.code) - order.indexOf(right.code),
    );

    rows.push({
      podNumber,
      podName: `Pod${podNumber}`,
      userId: entry.userId,
      fullName: entry.fullName,
      email: entry.email,
      status: !labs
        ? "unavailable"
        : total === 0 || completed === 0
          ? "not_started"
          : completed === total
            ? "completed"
            : "in_progress",
      completed,
      total,
      families,
      incompleteLabs,
    });
  }

  return rows.sort(
    (left, right) =>
      right.completed - left.completed ||
      left.podNumber.localeCompare(right.podNumber),
  );
}

export function summarizeStandings(rows: StandingRow[]) {
  return {
    students: rows.length,
    completedAll: rows.filter((row) => row.status === "completed").length,
    inProgress: rows.filter((row) => row.status === "in_progress").length,
    notStarted: rows.filter((row) => row.status === "not_started").length,
    labsCompleted: rows.reduce((sum, row) => sum + row.completed, 0),
    labsTotal: rows.reduce((sum, row) => sum + row.total, 0),
  };
}
