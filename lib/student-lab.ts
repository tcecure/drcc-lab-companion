import "server-only";

import { getPodAddresses } from "@/lib/pod-addresses";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types";

export type StudentCohortAssignment =
  Database["public"]["Tables"]["student_cohort_assignments"]["Row"];

export type StudentLabIdentity = ReturnType<typeof buildStudentLabIdentity>;

export async function getStudentCohortAssignment(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_cohort_assignments")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .order("cohort_number", { ascending: false });

  return pickStudentAssignment(data ?? []);
}

/**
 * A returning learner has a row per cohort. The one that matters is the lab
 * they can work in now: an unfinished cohort whose access has opened, then the
 * nearest cohort still ahead of them, and only then their last finished one.
 */
export function pickStudentAssignment<
  Assignment extends Pick<
    StudentCohortAssignment,
    "cohort_number" | "status" | "access_starts_at"
  >,
>(assignments: Assignment[], now = new Date()) {
  const newestFirst = [...assignments].sort(
    (left, right) => right.cohort_number - left.cohort_number,
  );
  const unfinished = newestFirst.filter((row) => row.status !== "completed");
  const hasOpened = (row: Assignment) => new Date(row.access_starts_at) <= now;

  return (
    unfinished.find(hasOpened) ??
    [...unfinished].reverse()[0] ??
    newestFirst[0] ??
    null
  );
}

export function getStudentLabIdentity(
  assignment: StudentCohortAssignment | null,
) {
  if (!assignment || assignment.seat_number === null) {
    return null;
  }

  return buildStudentLabIdentity(
    assignment.seat_number,
    assignment.pod_name,
    assignment.lab_username,
  );
}

export function buildStudentLabIdentity(
  seatNumber: number,
  assignedPodName?: string | null,
  assignedLabUsername?: string | null,
) {
  const studentNumber = String(seatNumber).padStart(2, "0");
  const podName = assignedPodName || `Pod${studentNumber}`;
  const labUsername = assignedLabUsername || `student${studentNumber}`;
  const domainName = "acs-p01.local";
  const netbiosDomain = "ACS-P01";
  const { gatewayAddress, podNetwork, sessionHostAddress } =
    getPodAddresses(seatNumber);

  return {
    studentNumber,
    podName,
    podPrefix: `P${studentNumber}`,
    podGroup: `POD${studentNumber}`,
    labUsername,
    domainName,
    netbiosDomain,
    domainUsername: `${labUsername}@${domainName}`,
    // The machine the student signs in to. Students used to work directly on a
    // domain controller; they now get their own domain-joined member server and
    // administer the directory remotely from it with RSAT.
    sessionHost: `POD${studentNumber}-SRV`,
    sessionHostAddress,
    // The directory the session host authenticates and binds against. Students
    // no longer open a session on either of these.
    domainControllers: ["DC01-P01", "DC02-P01"],
    gatewayName: `${podName}-GW`,
    gatewayAddress,
    podNetwork,
    guacamoleUrl: "https://guac.01.digitalrcc.com/#/",
    progressUrl: `https://training.digitalrcc.com/pod/${studentNumber}`,
    artifactsPath: `C:\\CyberLab\\${podName}\\`,
    scArtifactsPath: `C:\\CyberLab\\${podName}\\SC-Artifacts\\`,
  };
}
