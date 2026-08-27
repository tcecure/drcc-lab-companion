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
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
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
  const { gatewayAddress, podNetwork } = getPodAddresses(seatNumber);

  return {
    studentNumber,
    podName,
    podPrefix: `P${studentNumber}`,
    podGroup: `POD${studentNumber}`,
    labUsername,
    domainName,
    netbiosDomain,
    domainUsername: `${labUsername}@${domainName}`,
    domainController: `POD${studentNumber}-DC`,
    gatewayName: `${podName}-GW`,
    gatewayAddress,
    podNetwork,
    guacamoleUrl: "https://crc.guac.01.tcecure.com/#/",
    progressUrl: `https://training.status.tcecure.com/pod/${studentNumber}`,
    artifactsPath: `C:\\CyberLab\\${podName}\\`,
    scArtifactsPath: `C:\\CyberLab\\${podName}\\SC-Artifacts\\`,
  };
}
