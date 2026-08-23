import "server-only";

import type { LabStatusColor } from "@/lib/proxmox/status";
import { getLabStatus } from "@/lib/proxmox/status";
import { createAdminClient } from "@/lib/supabase/admin";

export type PublicOperationsSummary = {
  activeStudents: number | null;
  capacity: number;
  checkedAt: string | null;
  labStatus: LabStatusColor;
};

const DEFAULT_CAPACITY = 20;

async function getStudentCount() {
  const supabase = createAdminClient();
  const [students, capacity] = await Promise.all([
    supabase
      .from("student_cohort_assignments")
      .select("id", { count: "exact", head: true })
      .in("status", ["notified", "active"]),
    supabase
      .from("lab_capacity_settings")
      .select("maximum_active")
      .is("lab_track_id", null)
      .maybeSingle(),
  ]);

  if (students.error) {
    throw new Error(students.error.message);
  }

  return {
    activeStudents: students.count ?? 0,
    capacity: capacity.error
      ? DEFAULT_CAPACITY
      : (capacity.data?.maximum_active ?? DEFAULT_CAPACITY),
  };
}

export async function getPublicOperationsSummary(): Promise<PublicOperationsSummary> {
  const [studentResult, statusResult] = await Promise.allSettled([
    getStudentCount(),
    getLabStatus(),
  ]);
  const labStatus =
    statusResult.status === "fulfilled" ? statusResult.value : null;

  return {
    activeStudents:
      studentResult.status === "fulfilled"
        ? studentResult.value.activeStudents
        : null,
    capacity:
      studentResult.status === "fulfilled"
        ? studentResult.value.capacity
        : DEFAULT_CAPACITY,
    checkedAt: labStatus?.checkedAt ?? null,
    labStatus: labStatus?.color ?? "gray",
  };
}
