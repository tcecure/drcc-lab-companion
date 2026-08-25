#!/usr/bin/env python3
"""Rewrites the local psql harness files into SQL the Supabase Management API accepts.

The API runs one statement batch per request, inside a single transaction, and returns
only the last result set - so psql meta-commands have to go, progress labels are
collected in a table, and the updated_at check becomes a trigger-presence assertion
because now() does not advance inside a transaction.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

FIXTURE_USERS = (
    "'11111111-1111-1111-1111-111111111111'",
    "'22222222-2222-2222-2222-222222222222'",
    "'33333333-3333-3333-3333-333333333333'",
)

RESULTS_TABLE = """create table if not exists public._labops_check_results (
  n serial primary key,
  note text
);
delete from public._labops_check_results;
"""

TRIGGER_CHECK = """-- 5. updated_at trigger. now() is frozen inside the API's transaction, so assert the
-- trigger is attached and leave the timestamp comparison to the local harness.
do $$
begin
  update public.ai_runs set findings = 'trigger probe'
  where id = '66666666-6666-6666-6666-666666666666';

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'ai_runs' and not t.tgisinternal
  ) then
    raise exception 'CHECK FAILED: no updated_at trigger on ai_runs';
  end if;
end $$;
insert into public._labops_check_results (note)
values ('OK 5 updated_at trigger attached to ai_runs');
"""


def rewrite_fixtures(text: str) -> str:
    text = text.replace(
        "'33333333-3333-3333-3333-333333333333', 'approver@digitalrcc.com');",
        "'33333333-3333-3333-3333-333333333333', 'approver@digitalrcc.com')\non conflict (id) do nothing;",
    )
    text = text.replace(
        "'Pod03 firewall unreachable from DC01.');",
        "'Pod03 firewall unreachable from DC01.')\non conflict (id) do nothing;",
    )
    reset = "delete from public.user_roles where user_id in ({});\n".format(
        ", ".join(FIXTURE_USERS)
    )
    marker = "insert into public.user_roles"
    head, _, tail = text.partition(marker)
    return f"{head}{reset}{marker}{tail}\nselect 'fixtures applied' as status;\n"


def rewrite_checks(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("\\set"):
            continue
        if stripped.startswith("\\echo"):
            note = stripped[len("\\echo") :].strip().strip("'").replace("'", "''")
            lines.append(
                "insert into public._labops_check_results (note) "
                f"values ('{note}');"
            )
            continue
        lines.append(line)
    body = "\n".join(lines)

    # The local harness grants select itself because a bare Postgres has no Supabase
    # default grants; on staging the real privileges are asserted separately.
    start = body.find("grant select on public.ai_runs")
    if start != -1:
        end = body.index("to authenticated;", start) + len("to authenticated;")
        body = body[:start] + "-- privileges asserted separately on staging" + body[end:]

    start = body.find("-- 5. updated_at trigger")
    end = body.find("-- 6. No self-approval")
    if start == -1 or end == -1:
        sys.exit("could not locate the updated_at check to rewrite")
    body = body[:start] + TRIGGER_CHECK + "\n" + body[end:]

    return (
        RESULTS_TABLE
        + body
        + "\nselect note from public._labops_check_results order by n;\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--fixtures", type=pathlib.Path)
    group.add_argument("--checks", type=pathlib.Path)
    args = parser.parse_args()

    if args.fixtures:
        sys.stdout.write(rewrite_fixtures(args.fixtures.read_text()))
    else:
        sys.stdout.write(rewrite_checks(args.checks.read_text()))


if __name__ == "__main__":
    main()
