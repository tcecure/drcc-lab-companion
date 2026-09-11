import "server-only";

import {
  emptyImpactMetrics,
  parseImpactMetrics,
  rosterRange,
  type ImpactMetricsRow,
  type RosterParams,
} from "@/lib/moodle/impact";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";

export type RosterEntry =
  Database["public"]["Views"]["moodle_roster_entries"]["Row"];

export type TrackedCourseOption = {
  fullName: string;
  moodleCourseId: number;
};

export async function readImpactMetrics(): Promise<ImpactMetricsRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("moodle_impact_metrics");

  if (error) {
    return emptyImpactMetrics;
  }

  return parseImpactMetrics(data);
}

export async function readTrackedCourses(): Promise<TrackedCourseOption[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("moodle_catalog_courses")
    .select("moodle_course_id, full_name")
    .eq("tracked", true)
    .order("full_name", { ascending: true });

  return (data ?? []).map((course) => ({
    fullName: course.full_name,
    moodleCourseId: course.moodle_course_id,
  }));
}

/**
 * Roster reads are sorted, filtered and paginated in Postgres so the browser
 * never receives more than one page of learner records.
 */
export async function readRoster(params: RosterParams) {
  const supabase = createAdminClient();
  const { from, to } = rosterRange(params);
  const ascending = params.direction === "asc";

  let query = supabase
    .from("moodle_roster_entries")
    .select("*", { count: "exact" });

  if (params.search) {
    const term = `%${params.search.replace(/[%,]/g, "")}%`;
    query = query.or(`first_name.ilike.${term},last_name.ilike.${term}`);
  }

  if (params.courseId) {
    query = query.contains("course_ids", [params.courseId]);
  }

  if (params.status === "active") {
    query = query.gt("active_enrollments", 0);
  }

  if (params.status === "inactive") {
    query = query.eq("active_enrollments", 0);
  }

  if (params.completion === "complete") {
    query = query.gt("courses_completed", 0);
  }

  if (params.completion === "incomplete") {
    query = query.eq("courses_completed", 0);
  }

  const { count, data, error } = await query
    .order("last_name_sort", { ascending })
    .order("first_name_sort", { ascending })
    .order("moodle_user_id", { ascending })
    .range(from, to);

  return {
    entries: (data ?? []) as RosterEntry[],
    error: error?.message ?? null,
    total: count ?? 0,
  };
}
