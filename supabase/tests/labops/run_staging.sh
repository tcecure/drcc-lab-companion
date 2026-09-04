#!/usr/bin/env bash
# Runs the same behavioural checks as run.sh against a *staging* Supabase project,
# through the Management API SQL endpoint. Never point this at production: it seeds
# fixture rows and commits them. There is no staging deployment any more, so the
# production-safe substitute is prod_behaviour.sql, which rolls back everything it writes.
#
#   SUPABASE_ACCESS_TOKEN=... ./run_staging.sh <project-ref>
#
# The Management API executes the whole script in one transaction, so \echo and
# per-statement sessions are unavailable: check labels are collected in a table and
# selected at the end, and check 5 asserts the updated_at trigger exists rather than
# comparing timestamps (now() is frozen inside a transaction).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
M="${MIGRATIONS_DIR:-$HERE/../../migrations}"
REF="${1:?usage: run_staging.sh <project-ref>}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"

sql() {
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')
  curl -sS -X POST \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "https://api.supabase.com/v1/projects/$REF/database/query"
}

fail_on_error() { grep -q '"message"' <<<"$1" && { echo "$1"; exit 1; } || echo "$1"; }

echo "== base roles + fixtures (idempotent)"
fail_on_error "$(sql <<'EOF'
insert into public.roles (role_name, description) values
  ('student', 'Existing portal role'),
  ('approver', 'Existing portal role'),
  ('admin', 'Existing portal role')
on conflict (role_name) do nothing;
EOF
)"
fail_on_error "$(python3 "$HERE/staging_checks.py" --fixtures "$HERE/10_fixtures.sql" | sql)"

for f in "$M/PROPOSED_20260825000000_labops_ai_roles.sql" \
         "$M/PROPOSED_20260825010000_labops_ai_runs.sql"; do
  echo "== $(basename "$f")"
  fail_on_error "$(sql < "$f")"
done

echo "== privileges"
fail_on_error "$(sql <<'EOF'
do $$
begin
  if not has_table_privilege('authenticated', 'public.ai_runs', 'select')
     or has_table_privilege('authenticated', 'public.ai_runs', 'update')
     or has_table_privilege('anon', 'public.ai_runs', 'select')
     or has_table_privilege('service_role', 'public.ai_run_events', 'update') then
    raise exception 'CHECK FAILED: unexpected table privileges on the ai_* tables';
  end if;
end $$;
EOF
)"

echo "== behavioural checks"
fail_on_error "$(python3 "$HERE/staging_checks.py" --checks "$HERE/90_checks.sql" | sql)"

echo "== cleanup (leaves the schema, drops check rows)"
fail_on_error "$(sql <<'EOF'
delete from public.ai_model_usage;
delete from public.ai_tool_actions;
delete from public.ai_run_events;
delete from public.ai_messages;
delete from public.ai_artifacts;
delete from public.ai_approval_requests;
delete from public.ai_knowledge_proposals;
delete from public.ai_runs;
drop table if exists public._labops_check_results;
EOF
)"
echo "STAGING CHECKS PASSED"
