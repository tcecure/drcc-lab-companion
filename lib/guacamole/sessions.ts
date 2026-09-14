/**
 * Pure shaping of the Guacamole session payload pushed in by the lab-side
 * collector. Guacamole's own credentials never reach this application: the
 * collector runs inside the lab network, reads the Guacamole connection history
 * and posts sanitized session rows to a secret-protected route.
 */

export type GuacamoleSessionInput = {
  connectionName: string;
  endedAt: string | null;
  guacHistoryId: number;
  guacUserId: number | null;
  guacUsername: string;
  remoteHost: string | null;
  startedAt: string;
};

export type GuacamoleIngestPayload = {
  collectedAt: string;
  sessions: GuacamoleSessionInput[];
  webReachable: boolean | null;
  webError: string | null;
};

export type GuacamoleParseResult =
  | { ok: true; payload: GuacamoleIngestPayload }
  | { ok: false; error: string };

/** Open rows older than this are an abandoned session, not a live one. */
export const staleOpenSessionHours = 24;

function readText(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function readTimestamp(source: Record<string, unknown>, ...keys: string[]) {
  const raw = readText(source, ...keys);

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readInteger(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Math.trunc(Number(value));
    }
  }

  return 0;
}

export function parseGuacamoleIngest(body: unknown): GuacamoleParseResult {
  if (!body || typeof body !== "object") {
    return { error: "Body must be a JSON object.", ok: false };
  }

  const source = body as Record<string, unknown>;
  const rawSessions = source.sessions;

  if (!Array.isArray(rawSessions)) {
    return { error: "sessions must be an array.", ok: false };
  }

  const sessions: GuacamoleSessionInput[] = [];

  for (const entry of rawSessions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const guacHistoryId = readInteger(row, "historyId", "history_id");
    const guacUsername = readText(row, "username", "guac_username");
    const startedAt = readTimestamp(row, "startedAt", "start_date");

    if (guacHistoryId <= 0 || !guacUsername || !startedAt) {
      continue;
    }

    const guacUserId = readInteger(row, "userId", "user_id");

    sessions.push({
      connectionName: readText(row, "connectionName", "connection_name"),
      endedAt: readTimestamp(row, "endedAt", "end_date"),
      guacHistoryId,
      guacUserId: guacUserId > 0 ? guacUserId : null,
      guacUsername,
      remoteHost: readText(row, "remoteHost", "remote_host") || null,
      startedAt,
    });
  }

  const webReachable = source.webReachable;

  return {
    ok: true,
    payload: {
      collectedAt:
        readTimestamp(source, "collectedAt", "collected_at") ??
        new Date().toISOString(),
      sessions,
      webError: readText(source, "webError") || null,
      webReachable: typeof webReachable === "boolean" ? webReachable : null,
    },
  };
}

/**
 * A session row is only "live" while it is open and recent. An open row whose
 * start is older than the stale window means guacd or the web application lost
 * the session without writing an end date.
 */
export function isLiveSession(
  session: Pick<GuacamoleSessionInput, "endedAt" | "startedAt">,
  now: Date = new Date(),
) {
  if (session.endedAt) {
    return false;
  }

  const started = new Date(session.startedAt);

  if (Number.isNaN(started.getTime())) {
    return false;
  }

  return (
    now.getTime() - started.getTime() <= staleOpenSessionHours * 60 * 60 * 1000
  );
}
