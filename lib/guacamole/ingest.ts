import "server-only";

import type { GuacamoleIngestPayload } from "@/lib/guacamole/sessions";
import { createAdminClient } from "@/lib/supabase/admin";

export type GuacamoleIngestResult = {
  closed: number;
  openSessions: number;
  written: number;
};

/**
 * Stores one collector push. The collector reports every session that started
 * in its reporting window plus every row still open, so any row this side has
 * open but the collector no longer reports is a session that ended without an
 * end date being written; it is closed at the collection time rather than left
 * to look live forever.
 */
export async function ingestGuacamoleSessions(
  payload: GuacamoleIngestPayload,
): Promise<GuacamoleIngestResult> {
  const supabase = createAdminClient();

  if (payload.sessions.length) {
    const { error } = await supabase.from("guacamole_sessions").upsert(
      payload.sessions.map((session) => ({
        connection_name: session.connectionName,
        ended_at: session.endedAt,
        guac_history_id: session.guacHistoryId,
        guac_user_id: session.guacUserId,
        guac_username: session.guacUsername,
        remote_host: session.remoteHost,
        started_at: session.startedAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "guac_history_id" },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  const reportedOpen = new Set(
    payload.sessions
      .filter((session) => !session.endedAt)
      .map((session) => session.guacHistoryId),
  );

  const { data: openRows } = await supabase
    .from("guacamole_sessions")
    .select("guac_history_id")
    .is("ended_at", null);

  const orphaned = (openRows ?? [])
    .map((row) => Number(row.guac_history_id))
    .filter((historyId) => !reportedOpen.has(historyId));

  if (orphaned.length) {
    await supabase
      .from("guacamole_sessions")
      .update({ ended_at: payload.collectedAt, updated_at: new Date().toISOString() })
      .in("guac_history_id", orphaned);
  }

  await supabase.rpc("integration_connector_record", {
    connector_name: "guacamole_sessions",
    succeeded: true,
    new_cursor: null,
    error_text: null,
    new_detail: {
      collectedAt: payload.collectedAt,
      openSessions: reportedOpen.size,
      sessionsReported: payload.sessions.length,
      webError: payload.webError,
      webReachable: payload.webReachable,
    },
  });

  return {
    closed: orphaned.length,
    openSessions: reportedOpen.size,
    written: payload.sessions.length,
  };
}
