import "server-only";

import {
  activityEventFromMoodle,
  isLearnerActivity,
  loginFailureFromMoodle,
  type MoodleActivityEvent,
  type MoodleLoginFailure,
} from "@/lib/moodle/activity";
import {
  createMoodleClient,
  MoodleError,
  readMoodleConfig,
  type MoodleClient,
} from "@/lib/moodle/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types";

export type ActivityCollectionResult = {
  cursor: number;
  eventsWritten: number;
  failuresWritten: number;
  moreAvailable: boolean;
  prunedEvents: number;
};

/** Pages per run, so one collection can catch up without running unbounded. */
const maxPages = 5;
const pageSize = 1000;
const failurePageSize = 500;
/** First-run reach-back, in seconds. */
const initialLookbackSeconds = 7 * 24 * 60 * 60;

type EventsPayload = {
  events?: unknown[];
  maxid?: number;
  truncated?: boolean;
};

type FailuresPayload = {
  failures?: unknown[];
  maxid?: number;
  truncated?: boolean;
};

async function readCursor(
  supabase: ReturnType<typeof createAdminClient>,
  connector: string,
) {
  const { data } = await supabase
    .from("integration_connector_health")
    .select("cursor_value")
    .eq("connector", connector)
    .maybeSingle();

  return Number(data?.cursor_value ?? 0);
}

async function recordHealth(
  supabase: ReturnType<typeof createAdminClient>,
  connector: string,
  succeeded: boolean,
  cursor: number | null,
  errorText: string | null,
  detail: Json,
) {
  await supabase.rpc("integration_connector_record", {
    connector_name: connector,
    succeeded,
    new_cursor: cursor,
    error_text: errorText,
    new_detail: detail,
  });
}

/**
 * Pulls real Moodle log events forward from the stored cursor. The Moodle log
 * id is monotonic, so a cursor read can never miss or duplicate a row, and the
 * unique constraint on moodle_log_id makes a retry harmless.
 */
async function collectEvents(client: MoodleClient, startCursor: number) {
  const supabase = createAdminClient();
  let cursor = startCursor;
  let written = 0;
  let moreAvailable = false;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await client.call<EventsPayload>(
      "local_drccops_get_recent_events",
      {
        sinceid: cursor,
        since:
          cursor > 0
            ? 0
            : Math.floor(Date.now() / 1000) - initialLookbackSeconds,
        limit: pageSize,
      },
    );

    const events = (payload.events ?? [])
      .map((event) => activityEventFromMoodle(event))
      .filter((event): event is MoodleActivityEvent => Boolean(event));
    const learnerEvents = events.filter(isLearnerActivity);

    if (learnerEvents.length) {
      const { error } = await supabase.from("moodle_activity_events").upsert(
        learnerEvents.map((event) => ({
          action: event.action,
          component: event.component,
          course_id: event.courseId,
          event_name: event.eventName,
          moodle_log_id: event.moodleLogId,
          moodle_user_id: event.moodleUserId,
          occurred_at: event.occurredAt,
          origin: event.origin,
          source_ip: event.sourceIp,
        })),
        { onConflict: "moodle_log_id" },
      );

      if (error) {
        throw new MoodleError(error.message, "activity_write_failed");
      }

      written += learnerEvents.length;
    }

    const maxId = Number(payload.maxid ?? 0);
    if (maxId > cursor) {
      cursor = maxId;
    }

    if (!payload.truncated || !events.length) {
      moreAvailable = false;
      break;
    }

    moreAvailable = true;
  }

  return { cursor, moreAvailable, written };
}

async function collectFailures(client: MoodleClient, startCursor: number) {
  const supabase = createAdminClient();
  let cursor = startCursor;
  let written = 0;

  const payload = await client.call<FailuresPayload>(
    "local_drccops_get_failed_logins",
    {
      sinceid: cursor,
      since:
        cursor > 0
          ? 0
          : Math.floor(Date.now() / 1000) - initialLookbackSeconds,
      limit: failurePageSize,
    },
  );

  const failures = (payload.failures ?? [])
    .map((failure) => loginFailureFromMoodle(failure))
    .filter((failure): failure is MoodleLoginFailure => Boolean(failure));

  if (failures.length) {
    const { error } = await supabase.from("moodle_login_failures").upsert(
      failures.map((failure) => ({
        attempted_username: failure.attemptedUsername,
        moodle_log_id: failure.moodleLogId,
        moodle_user_id: failure.moodleUserId,
        occurred_at: failure.occurredAt,
        reason: failure.reason,
        source_ip: failure.sourceIp,
      })),
      { onConflict: "moodle_log_id" },
    );

    if (error) {
      throw new MoodleError(error.message, "login_failure_write_failed");
    }

    written = failures.length;
  }

  const maxId = Number(payload.maxid ?? 0);
  if (maxId > cursor) {
    cursor = maxId;
  }

  return { cursor, written };
}

/**
 * One activity collection run: real Moodle events, failed logins, and a prune
 * of anything past the retention window. Each connector records its own health
 * so a partial failure is visible in Live Operations instead of looking like an
 * idle cohort.
 */
export async function runActivityCollection(): Promise<ActivityCollectionResult> {
  const config = readMoodleConfig();

  if (!config) {
    throw new MoodleError(
      "Moodle is not configured: MOODLE_BASE_URL and MOODLE_API_TOKEN are required.",
      "not_configured",
    );
  }

  const supabase = createAdminClient();
  const client = createMoodleClient(config);

  const eventCursor = await readCursor(supabase, "moodle_activity");
  let events: Awaited<ReturnType<typeof collectEvents>>;

  try {
    events = await collectEvents(client, eventCursor);
  } catch (error) {
    await recordHealth(
      supabase,
      "moodle_activity",
      false,
      null,
      error instanceof Error ? error.message : "Activity collection failed.",
      {},
    );
    throw error;
  }

  await recordHealth(supabase, "moodle_activity", true, events.cursor, null, {
    eventsWritten: events.written,
    moreAvailable: events.moreAvailable,
  });

  const failureCursor = await readCursor(supabase, "moodle_login_failures");
  let failures = { cursor: failureCursor, written: 0 };

  try {
    failures = await collectFailures(client, failureCursor);
    await recordHealth(
      supabase,
      "moodle_login_failures",
      true,
      failures.cursor,
      null,
      { failuresWritten: failures.written },
    );
  } catch (error) {
    await recordHealth(
      supabase,
      "moodle_login_failures",
      false,
      null,
      error instanceof Error ? error.message : "Failed login read failed.",
      {},
    );
  }

  const { data: pruned } = await supabase.rpc("moodle_prune_activity", {});

  return {
    cursor: events.cursor,
    eventsWritten: events.written,
    failuresWritten: failures.written,
    moreAvailable: events.moreAvailable,
    prunedEvents: Number(pruned ?? 0),
  };
}
