---
name: testing-local-supabase
description: How to run the DigitalRCC portal (drcc-lab-companion) locally against a throwaway LOCAL Supabase stack with your own admin/student users, when no portal login is available and production must not be mutated. Covers port conflicts, the fact that repo migrations are NOT standalone, and browser assertions for admin pages.
---

# Testing portal admin pages against a local Supabase stack

Use this when you must exercise an authenticated portal page (e.g. `/admin/...`) and you have
no portal credentials, or you must not touch production data/users.

## Key facts

- `supabase/migrations/*` in this repo are **additive** migrations for an already-existing
  application schema. `supabase db reset` / applying them to an empty DB fails with e.g.
  `relation "public.student_cohort_assignments" does not exist`. You must bootstrap a base
  schema first (a read-only dump of the production `public` schema metadata works: tables,
  columns, constraints, views, functions), then apply the PR migration on top.
  - Generated-column defaults (e.g. `resources.search_vector`) may need to be dropped from a
    reconstructed bootstrap (`cannot use column reference in DEFAULT expression`).
- Default Supabase ports 54321/54322 may already be taken by another stack on the box
  (`Bind for 0.0.0.0:54322 failed`). Run `npx supabase init` and edit `supabase/config.toml`
  to a free range (e.g. API 54421, DB 54422, Studio 54423, Inbucket 54424, shadow 54420).
  `supabase/config.toml` and `supabase/.gitignore` are then untracked artifacts — leave or
  remove them, but never commit them with a PR.
- `lib/env.ts` accepts `SUPABASE_SERVICE_ROLE_KEY` as a fallback for `SUPABASE_SECRET_KEY`,
  so the local `supabase status` service key works directly.
- Start the dev server from a **persistent shell** (`bash /tmp/start-x.sh > /tmp/dev.log 2>&1`);
  backgrounded one-shot chains die. Delete `.next` first if the server previously ran against a
  different Supabase project — stale build output can still reference the old project ref.
- Create local users via the local auth admin API, then insert the matching profile/role rows.
  Never use `SUPABASE_ACCESS_TOKEN` to create or reset a *production* user.

## Verifying an admin page in the browser

- Responsive layout: the CDP viewport does **not** follow `xdotool windowsize` while a device
  metrics override is active. Use `set_mobile` for the phone breakpoint; after turning it off,
  window resizes do apply. Assert the breakpoint numerically with
  `getComputedStyle(cardsGrid).gridTemplateColumns` (count of tracks) plus a screenshot.
- "Does the server leak X?" questions must be answered from the **served HTML**, not the DOM:
  `fetch(location.href,{credentials:'include'}).then(r=>r.text())` in the page console, assign
  the result to a `window.__x` global, then read `window.__x` in a second console call
  (top-level `await` is unavailable and promise results are not returned).
- In `next dev`, server-action metadata embeds absolute repo paths
  (`/home/ubuntu/.../.next/dev/server/chunk...`) in the HTML for *every* action, including
  pre-existing ones. This is a dev-mode artifact, not a PR leak — verify against a production
  build before reporting it.
- Filter forms submitted with a GET `Apply` button emit every field (including `dir=asc` and
  empty `course=`), while helper-built sort links may omit defaults. Check both paths before
  reporting a "missing query param".
- Options that depend on data (e.g. a course filter) cannot be exercised on an empty DB —
  report them untested rather than seeding fake rows, unless seeding is explicitly allowed.

## Seeding data-dependent behaviour (roster, pagination, filters)

When the lead explicitly allows local seeding, generate deterministic rows straight into the
`moodle_*` projection tables rather than trying to run a real Moodle sync:

- `psql` is usually **not installed on the box** — run SQL inside the DB container:
  `docker cp seed.sql supabase_db_<repo>:/tmp/seed.sql && docker exec supabase_db_<repo> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/seed.sql`.
- Seed enough variety to make each control falsifiable: several courses (one *untracked*, one
  hidden, one ended), duplicate last names with differing first names (proves the secondary sort
  key), active/inactive enrollments, `complete`/`incomplete`/`unknown` completion states, an
  excluded learner, and >100 learners so both page sizes paginate.
- Compute every expected count with independent SQL against `moodle_roster_entries` and compare
  with the UI's "N students" / "Showing a–b of N" text. Note `course_ids` is `bigint[]`, so use
  `course_ids @> array[102]::bigint[]`.
- Eligible-completion logic is `completion_state in ('complete','incomplete')`. To exercise the
  "Completion data unavailable" (`—`) path, back the column up into a temp table, set every row
  to `'unknown'`, check the UI, then restore from the backup — don't re-seed from scratch.
- Sort/pagination links omit default params (`dir=asc`, `pageSize=25`, `page=1`); non-default
  values *are* carried through `Next`/`Previous`. Assert persistence with a non-default combo
  such as `?pageSize=50&dir=desc&page=2`.
- The protected sync route returns `503 {"error":"MOODLE_SYNC_SECRET is not set."}` locally when
  the secret is unset, i.e. it answers before auth — so a local 503 does **not** prove the
  production 401-without-secret behaviour. Test that separately/anonymously against the deployed
  environment if it matters.

## Seeding cohort seats for /admin/progress (Student Progress)

- Seats live in `public.student_cohort_assignments`. Constraints to respect when seeding:
  `cohort_number > 0`, `seat_number` 1–20, `pod_name` must match `Pod01`…`Pod20`,
  `status in ('queued','notified','active','completed','cancelled')`, unique `(cohort_number, seat_number)`
  and unique `user_id` — so one seat per user; re-seat a user by updating/deleting the old row.
- Each seat needs a matching `public.profiles` row for the name/email to render. There is **no**
  `auth.users` → `profiles` trigger locally: create the auth user via the local Supabase admin API,
  then INSERT the profile row manually with the same `id`.
- The "current cohort" is computed in code from `lib/cohorts.ts` (window containing `now`), not from
  the DB, so to test the between-cohorts fallback you change the *seed data's* `cohort_number`
  rather than any date. Eyebrow strings are the discriminator:
  `Active cohort N` / `Cohort N · most recent assigned cohort` / `Cohort N · no seats assigned` /
  `No active cohort`.
- Export `TRAINING_TRACKER_BASE_URL=https://training.digitalrcc.com` in the dev-server env;
  that host and `/training/status/pod/NN` are reachable from the box, so the tracker iframe and the
  20 empty-state pod links load real content. Verify link targets from the **saved full HTML**
  (`/tmp/page_html_*.html`) — the stripped browser DOM truncates long hrefs.

## Seeding cohort snapshots (per-cohort Student Progress standings)

- `public.cohort_progress_snapshots` is one row per cohort (`status` `interim`|`final`,
  `courses` family -> {name, labs[]}, `pods` `pod01` -> labId -> {completed, reason},
  `waived_labs`). Recovered AWX artifacts may be **family-nested**; the DB expects a flat
  `pod01 -> labId` map. Lab ids are globally unique, so flattening is lossless.
- Insert the JSON with PostgreSQL dollar-quoting from a host-side Python/psql heredoc. `psql` runs
  **inside** the `supabase_db_*` container, so `\copy`/`cat` of a host `/tmp/*.json` path fails —
  embed the JSON in the statement instead.
- Waiver arithmetic is the cheapest falsifiable assertion: with `waived_labs=["M3-L2"]` a 57-lab
  payload must render `56` denominators and untouched pods `0/56` (never `1/57`).
- The snapshot route (`/api/integrations/tracker/snapshot`, GET/POST) needs
  `TRACKER_SNAPSHOT_SECRET` (or `CRON_SECRET`) exported in the dev-server env; auth is
  `Authorization: Bearer <secret>` or `?secret=`. To prove a `final` row is frozen, compare
  `status, captured_at, updated_at, md5(pods::text), md5(courses::text)` before/after the call.
  Expect the call to legitimately create/refresh an `interim` row for the *active* cohort.
- Useful probe: seat a pod that is **absent** from the snapshot. Expected `No data` / `0/0`; watch
  for copy that implies success (a "completed everything" message on a 0/0 row) and for outcome
  summary counts that omit the no-data rows.

## Devin Secrets Needed

- None for the local stack. `SUPABASE_ACCESS_TOKEN` is only needed for **read-only** production
  schema comparison; never use it to mutate production.
