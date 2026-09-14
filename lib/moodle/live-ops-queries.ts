import "server-only";

import { liveOpsRange, type LiveOpsParams } from "@/lib/live-ops";
import {
  eventCountColumn,
  type ActivityStatus,
  type ActivityWindow,
} from "@/lib/moodle/activity";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";

export type LiveOpsEntry =
  Database["public"]["Views"]["moodle_live_operations_entries"]["Row"];

export type ConnectorHealthRow =
  Database["public"]["Tables"]["integration_connector_health"]["Row"];

export type LiveOpsFilterOptions = {
  cohorts: number[];
  pods: string[];
};

export type StudentActivityEvent = {
  action: string;
  courseId: number | null;
  courseName: string | null;
  eventName: string;
  occurredAt: string;
  origin: string;
  sourceIp: string | null;
};

export type StudentGuacamoleSession = {
  connectionName: string;
  endedAt: string | null;
  remoteHost: string | null;
  startedAt: string;
};

export type StudentLoginFailure = {
  attemptedUsername: string;
  occurredAt: string;
  reason: string;
  sourceIp: string | null;
};

export type StudentCourseProgress = {
  completedAt: string | null;
  completionState: "complete" | "incomplete" | "unknown";
  courseName: string;
  lastAccessAt: string | null;
  moodleCourseId: number;
  progressPercentage: number | null;
};

export type StudentIpObservation = {
  events: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceIp: string;
};

export type StudentDetail = {
  courses: StudentCourseProgress[];
  entry: LiveOpsEntry | null;
  events: StudentActivityEvent[];
  guacamoleSessions: StudentGuacamoleSession[];
  ipHistory: StudentIpObservation[];
  loginFailures: StudentLoginFailure[];
};

/**
 * Live Operations reads are filtered, sorted and paginated in Postgres so the
 * browser only ever receives one page of operational records.
 */
export async function readLiveOps(params: LiveOpsParams) {
  const supabase = createAdminClient();
  const { from, to } = liveOpsRange(params);
  const ascending = params.direction === "asc";
  const countColumn = eventCountColumn(params.window);

  let query = supabase
    .from("moodle_live_operations_entries")
    .select("*", { count: "exact" });

  if (params.search) {
    const term = `%${params.search.replace(/[%,]/g, "")}%`;
    query = query.or(
      [
        `first_name.ilike.${term}`,
        `last_name.ilike.${term}`,
        `email.ilike.${term}`,
        `lab_username.ilike.${term}`,
        `pod_name.ilike.${term}`,
        `session_host.ilike.${term}`,
      ].join(","),
    );
  }

  if (params.cohort) {
    query = query.eq("cohort_number", params.cohort);
  }

  if (params.courseId) {
    query = query.contains("course_ids", [params.courseId]);
  }

  if (params.pod) {
    query = query.eq("pod_name", params.pod);
  }

  if (params.activity === "active_in_window") {
    query = query.gt(countColumn, 0);
  }

  if (params.activity === "idle_in_window") {
    query = query.eq(countColumn, 0);
  }

  if (params.attention === "needs_attention") {
    query = query.eq("needs_attention", true);
  }

  if (params.session === "in_session") {
    query = query.gt("guac_open_sessions", 0);
  }

  query =
    params.sort === "activity"
      ? query
          .order("last_event_at", { ascending, nullsFirst: false })
          .order("last_name_sort", { ascending: true })
      : query
          .order("last_name_sort", { ascending })
          .order("first_name_sort", { ascending });

  const { count, data, error } = await query
    .order("moodle_user_id", { ascending: true })
    .range(from, to);

  return {
    entries: (data ?? []) as LiveOpsEntry[],
    error: error?.message ?? null,
    total: count ?? 0,
  };
}

export async function readLiveOpsFilterOptions(): Promise<LiveOpsFilterOptions> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("student_cohort_assignments")
    .select("cohort_number, pod_name")
    .neq("status", "cancelled");

  const cohorts = new Set<number>();
  const pods = new Set<string>();

  for (const row of data ?? []) {
    if (typeof row.cohort_number === "number") {
      cohorts.add(row.cohort_number);
    }
    if (row.pod_name) {
      pods.add(row.pod_name);
    }
  }

  return {
    cohorts: [...cohorts].sort((left, right) => right - left),
    pods: [...pods].sort((left, right) => left.localeCompare(right)),
  };
}

export async function readConnectorHealth(): Promise<ConnectorHealthRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("integration_connector_health")
    .select("*")
    .order("connector", { ascending: true });

  return (data ?? []) as ConnectorHealthRow[];
}

/** Counts per activity status for the summary cards, over the whole cohort. */
export async function readActivitySummary(window: ActivityWindow) {
  const supabase = createAdminClient();
  const countColumn = eventCountColumn(window);

  const [total, inWindow, inSession, attention] = await Promise.all([
    supabase
      .from("moodle_live_operations_entries")
      .select("moodle_user_id", { count: "exact", head: true }),
    supabase
      .from("moodle_live_operations_entries")
      .select("moodle_user_id", { count: "exact", head: true })
      .gt(countColumn, 0),
    supabase
      .from("moodle_live_operations_entries")
      .select("moodle_user_id", { count: "exact", head: true })
      .gt("guac_open_sessions", 0),
    supabase
      .from("moodle_live_operations_entries")
      .select("moodle_user_id", { count: "exact", head: true })
      .eq("needs_attention", true),
  ]);

  return {
    activeInWindow: inWindow.count ?? 0,
    inGuacamoleSession: inSession.count ?? 0,
    learners: total.count ?? 0,
    needsAttention: attention.count ?? 0,
  };
}

/**
 * Everything the student drawer shows. Read-only: the drawer offers no action
 * that can change Moodle, Guacamole or the lab.
 */
export async function readStudentDetail(
  moodleUserId: number,
): Promise<StudentDetail> {
  const supabase = createAdminClient();

  const { data: entryRow } = await supabase
    .from("moodle_live_operations_entries")
    .select("*")
    .eq("moodle_user_id", moodleUserId)
    .maybeSingle();

  const entry = (entryRow ?? null) as LiveOpsEntry | null;

  const [eventRows, courseRows, catalogRows, failureRows] = await Promise.all([
    supabase
      .from("moodle_activity_events")
      .select("event_name, action, course_id, occurred_at, origin, source_ip")
      .eq("moodle_user_id", moodleUserId)
      .order("occurred_at", { ascending: false })
      .limit(200),
    supabase
      .from("moodle_course_enrollments")
      .select(
        "moodle_course_id, completion_state, completed_at, progress_percentage, last_access_at",
      )
      .eq("moodle_user_id", moodleUserId),
    supabase
      .from("moodle_catalog_courses")
      .select("moodle_course_id, full_name"),
    supabase
      .from("moodle_login_failures")
      .select("attempted_username, occurred_at, reason, source_ip")
      .or(
        entry?.moodle_username
          ? `moodle_user_id.eq.${moodleUserId},attempted_username.ilike.${entry.moodle_username}`
          : `moodle_user_id.eq.${moodleUserId}`,
      )
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  const courseNames = new Map<number, string>();
  for (const course of catalogRows.data ?? []) {
    courseNames.set(Number(course.moodle_course_id), course.full_name);
  }

  const events: StudentActivityEvent[] = (eventRows.data ?? []).map((row) => ({
    action: row.action ?? "",
    courseId: row.course_id === null ? null : Number(row.course_id),
    courseName:
      row.course_id === null
        ? null
        : courseNames.get(Number(row.course_id)) ?? null,
    eventName: row.event_name,
    occurredAt: row.occurred_at,
    origin: row.origin ?? "",
    sourceIp: row.source_ip ?? null,
  }));

  const ipHistory = new Map<string, StudentIpObservation>();
  for (const event of events) {
    if (!event.sourceIp) {
      continue;
    }

    const existing = ipHistory.get(event.sourceIp);

    if (!existing) {
      ipHistory.set(event.sourceIp, {
        events: 1,
        firstSeenAt: event.occurredAt,
        lastSeenAt: event.occurredAt,
        sourceIp: event.sourceIp,
      });
      continue;
    }

    existing.events += 1;
    if (event.occurredAt < existing.firstSeenAt) {
      existing.firstSeenAt = event.occurredAt;
    }
    if (event.occurredAt > existing.lastSeenAt) {
      existing.lastSeenAt = event.occurredAt;
    }
  }

  let guacamoleSessions: StudentGuacamoleSession[] = [];

  if (entry?.lab_username) {
    const { data: sessionRows } = await supabase
      .from("guacamole_sessions")
      .select("connection_name, remote_host, started_at, ended_at")
      .ilike("guac_username", entry.lab_username)
      .order("started_at", { ascending: false })
      .limit(50);

    guacamoleSessions = (sessionRows ?? []).map((row) => ({
      connectionName: row.connection_name ?? "",
      endedAt: row.ended_at,
      remoteHost: row.remote_host,
      startedAt: row.started_at,
    }));
  }

  const courses: StudentCourseProgress[] = (courseRows.data ?? [])
    .map((row) => ({
      completedAt: row.completed_at,
      completionState: row.completion_state,
      courseName:
        courseNames.get(Number(row.moodle_course_id)) ??
        `Course ${row.moodle_course_id}`,
      lastAccessAt: row.last_access_at,
      moodleCourseId: Number(row.moodle_course_id),
      progressPercentage:
        row.progress_percentage === null ? null : Number(row.progress_percentage),
    }))
    .sort((left, right) => left.courseName.localeCompare(right.courseName));

  return {
    courses,
    entry,
    events: events.slice(0, 50),
    guacamoleSessions,
    ipHistory: [...ipHistory.values()].sort((left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt),
    ),
    loginFailures: (failureRows.data ?? []).map((row) => ({
      attemptedUsername: row.attempted_username ?? "",
      occurredAt: row.occurred_at,
      reason: row.reason ?? "",
      sourceIp: row.source_ip ?? null,
    })),
  };
}

export function statusFromEntry(entry: LiveOpsEntry): ActivityStatus {
  const status = entry.activity_status;

  if (
    status === "active_now" ||
    status === "active_2h" ||
    status === "active_24h" ||
    status === "active_7d"
  ) {
    return status;
  }

  return "no_recent_activity";
}
