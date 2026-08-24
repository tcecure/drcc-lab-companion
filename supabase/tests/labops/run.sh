#!/usr/bin/env bash
# Validates the PROPOSED LabOps migrations against a throwaway local Postgres.
# Touches no Supabase project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
M="${MIGRATIONS_DIR:-$HERE/../../migrations}"
PG="${PG_CONTAINER:-labops-pg}"

psql_file() { docker exec -i "$PG" psql -U postgres -d labops_test -v ON_ERROR_STOP=1 -q < "$1"; }

docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists labops_test" -c "create database labops_test"

for f in "$HERE/00_harness_base.sql" "$HERE/10_fixtures.sql" \
         "$M/PROPOSED_20260825000000_labops_ai_roles.sql" \
         "$M/PROPOSED_20260825010000_labops_ai_runs.sql" \
         "$HERE/90_checks.sql"; do
  echo "== $(basename "$f")"
  psql_file "$f"
done

echo "== idempotency replay"
psql_file "$M/PROPOSED_20260825000000_labops_ai_roles.sql"
psql_file "$M/PROPOSED_20260825010000_labops_ai_runs.sql"
echo "ALL CHECKS PASSED"
