#!/usr/bin/env python3
"""Push read-only Guacamole session history to the DRCC Lab Companion.

Runs on the Guacamole host inside the lab network, so no Guacamole credential
ever reaches the Vercel application and the Guacamole database is never exposed
to the internet. Every interval it reads recent rows from
guacamole_connection_history with a read-only database role and POSTs them to
the portal's secret-protected ingest route.

Configuration comes from the environment (see collector.env.example):

  GUAC_DB_CONTAINER         guac-postgres (docker exec target; empty = local psql)
  GUAC_DB_NAME              guacamole_db
  GUAC_DB_USER              guac_portal_ro
  PGPASSWORD                password for that role
  GUAC_WEB_URL              https://crc.guac.01.tcecure.com (optional reachability probe)
  DRCC_INGEST_URL           https://my.digitalrcc.com/api/integrations/guacamole/sessions
  GUACAMOLE_INGEST_SECRET   bearer secret shared with the portal
  GUAC_LOOKBACK_HOURS       48
  POLL_INTERVAL_SECONDS     120 (0 = run once and exit, for a systemd timer)

The query is a plain SELECT. The role has SELECT only, so a bug here cannot
change anything in Guacamole.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DB_CONTAINER = os.environ.get("GUAC_DB_CONTAINER", "guac-postgres")
DB_NAME = os.environ.get("GUAC_DB_NAME", "guacamole_db")
DB_USER = os.environ.get("GUAC_DB_USER", "guac_portal_ro")
WEB_URL = os.environ.get("GUAC_WEB_URL", "").rstrip("/")
INGEST_URL = os.environ["DRCC_INGEST_URL"]
INGEST_SECRET = os.environ["GUACAMOLE_INGEST_SECRET"]
LOOKBACK_HOURS = int(os.environ.get("GUAC_LOOKBACK_HOURS", "48"))
INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "120"))

# Open rows first so a truncated read still reports live sessions. remote_host is
# the student's public address as Guacamole recorded it.
QUERY = """
select json_agg(row_to_json(session)) from (
  select
    history.history_id as "historyId",
    history.username,
    history.user_id as "userId",
    coalesce(connection.connection_name, history.connection_name, '') as "connectionName",
    history.remote_host as "remoteHost",
    to_char(history.start_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SSZ') as "startedAt",
    to_char(history.end_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SSZ') as "endedAt"
  from guacamole_connection_history history
  left join guacamole_connection connection
    on connection.connection_id = history.connection_id
  where history.end_date is null
     or history.end_date > now() - interval '{hours} hours'
  order by (history.end_date is null) desc, history.start_date desc
  limit 2000
) session
"""


def read_sessions() -> list[dict[str, object]]:
    """Reads recent history rows as JSON with the read-only role."""
    sql = QUERY.format(hours=LOOKBACK_HOURS)
    psql = [
        "psql",
        "-U",
        DB_USER,
        "-d",
        DB_NAME,
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
    ]
    command = psql
    env = dict(os.environ)

    if DB_CONTAINER:
        command = [
            "docker",
            "exec",
            "-e",
            f"PGPASSWORD={env.get('PGPASSWORD', '')}",
            "-i",
            DB_CONTAINER,
            *psql,
        ]

    result = subprocess.run(
        command, capture_output=True, check=True, env=env, text=True, timeout=120
    )
    payload = result.stdout.strip()

    if not payload or payload == "":
        return []

    rows = json.loads(payload)
    return rows if isinstance(rows, list) else []


def probe_web() -> tuple[bool | None, str | None]:
    """Records whether the Guacamole web application answers, without a login."""
    if not WEB_URL:
        return None, None

    request = urllib.request.Request(f"{WEB_URL}/", method="GET")

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return 200 <= response.status < 400, None
    except urllib.error.HTTPError as error:
        # An authentication challenge still proves the application is up.
        if error.code in (401, 403):
            return True, None
        return False, f"HTTP {error.code}"
    except Exception as error:  # noqa: BLE001 - reported, never raised onward
        return False, str(error)[:200]


def post(payload: dict[str, object]) -> None:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        INGEST_URL,
        data=body,
        headers={
            "authorization": f"Bearer {INGEST_SECRET}",
            "content-type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        detail = response.read().decode("utf-8", "replace")[:300]
        print(f"ingest {response.status}: {detail}", flush=True)


def collect_once() -> int:
    web_reachable, web_error = probe_web()

    try:
        sessions = read_sessions()
    except Exception as error:  # noqa: BLE001 - a read failure must be visible
        print(f"guacamole read failed: {error}", file=sys.stderr, flush=True)
        return 1

    payload = {
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "sessions": sessions,
        "webError": web_error,
        "webReachable": web_reachable,
    }

    try:
        post(payload)
    except Exception as error:  # noqa: BLE001 - retried on the next interval
        print(f"ingest failed: {error}", file=sys.stderr, flush=True)
        return 1

    return 0


def main() -> int:
    if INTERVAL <= 0:
        return collect_once()

    while True:
        collect_once()
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
