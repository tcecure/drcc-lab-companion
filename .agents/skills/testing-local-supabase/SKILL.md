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
- **`.env.local` in this repo points at production** (`NEXT_PUBLIC_SUPABASE_URL` is the
  `kkacbtkacadgsnbylkti.supabase.co` project, with a live secret key). Never `source .env.local`
  for a local run or a node/vitest script that writes: the writes land in production. Pass the
  local values explicitly instead — `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api port>` plus
  the local stack's service key, which you can read without the CLI via
  `docker inspect supabase_studio_drcc-lab-companion --format '{{json .Config.Env}}'`
  (`SUPABASE_SERVICE_KEY`).
- A node script that talks to Supabase needs Node ≥ 22 (`/home/ubuntu/.nvm/versions/node/v22.12.0/bin`
  on PATH); on the default Node 20 `@supabase/supabase-js` fails at construction with
  `WebSocket is not available`.

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
  and (since migration `20261003000000_repeat_cohort_enrollment.sql`) unique `(user_id, cohort_number)`
  — a learner may hold one seat **per cohort**, so a finished learner can be re-enrolled later. On
  older local DBs the legacy `student_cohort_assignments_user_id_key` may still exist and will
  break repeat-enrollment tests; check with `\d student_cohort_assignments` before blaming the code.
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

## Repeat cohort enrollment + pod reuse (`/admin/import`, `/admin/queue` close-out)

- The flow to exercise: `/admin/import` → "Add up to 10 students" (name + email + **Cohort** select)
  → `Import manual entries`. Importing into a cohort whose 01:00 assignment time has already passed
  queues **and** seats immediately, so pick the in-progress cohort to see pods allocated in one step.
  Banner wording is the cheapest oracle: `Queued 1 students, assigned 1 student numbers now.` on a
  real insert vs `Queued 0 students, 1 already had a queue entry.` on an idempotent re-import.
- Make seat allocation **falsifiable before you click**. A seat is unavailable if it belongs to the
  target cohort OR to any assignment that is not `completed` (any cohort). So seed a mix:
  completed rows in an old cohort (reusable pods), one `active`/`notified` straggler in an old
  cohort (pod still held), and the live cohort's own seats. Compute the expected pod by hand first —
  e.g. held {1,2,3,4,5} → next learner must get **Pod06**; if the code only looked at the target
  cohort it would hand out Pod03, which is the discriminator.
- Pod release is driven by the "Close out a cohort" card on `/admin/queue` (`completeCohortAction`,
  manager-only). The card only lists cohorts that still hold seats. Closing cohort N says
  `Closed cohort N: X students marked completed and their pods released.`, moves those rows to
  "Archived students", and the *next* import should then claim the lowest released pod (Pod03 in the
  example above) — not the next unused one. Note closing a cohort is **not reversible** from the UI;
  it is the only way to free pods, so seed a cohort you are willing to lose.
- Repeat-enrollment regression guard: capture `md5(row::text)` of the learner's old completed
  assignment before the import and re-check after; it must be byte-identical, and
  `select count(*) ... where user_id=? and cohort_number=?` must stay 1 across a re-import.
- Emails: `EMAIL_DELIVERY_MODE` defaults to `mock`, so nothing leaves the box; the artifact is
  `public.email_jobs`. Expect exactly one `student_lab_queue_confirmation` per new enrollment plus
  one `student_lab_seat_assigned` when the import seats immediately, and assert every recipient
  domain is a local test domain.
- `/student/start` picks the newest **unfinished** cohort (`pickStudentAssignment`), so a returning
  learner must read their new `Student NN` / `PodNN` / `studentNN` everywhere (heading, identity
  tile, Step 1, Lab Access card title) and never their finished identity.
- Authz check that works without curl: the student session redirects off `/admin/queue` to
  `/student`. For the adversarial half, grab the close-out server-action id from the **admin** page's
  saved HTML (`grep -o 'ACTION_ID_[0-9a-f]*' /tmp/page_html_*.html` — the id that appears **twice**
  is `completeCohortAction`, once per close-out button), then from the student's own session run a
  console `fetch('/admin/queue', {method:'POST', headers:{'Next-Action': '<id>'}, body: fd})` with
  `cohort` in the FormData. A hand-built FormData body returns `500 Error: Connection closed.`
  (Next cannot decode it) rather than a clean redirect — that is an artifact of the replay, so the
  real assertion is the DB: no row of that cohort may become `completed`.

## AWX verifier progress push + tracker fallback (`/api/integrations/awx/progress`)

- Needs `AWX_PROGRESS_SECRET` in `.env.local`; auth is **`Authorization: Bearer` only** — a secret in
  `?secret=`/`?token=` must 401. The route is POST-only (GET/PUT return 405).
- `public.awx_verifier_progress` is one row per control family (PK `family`), RLS on with no
  policies, `updated_at` maintained by a trigger. Read it with
  `docker exec supabase_db_drcc-lab-companion psql -U postgres -d postgres`. An anon-key REST read
  (`/rest/v1/awx_verifier_progress?select=*`) must return exactly `[]`.
- Payload gotchas worth asserting: `family` is upper-cased (`"ac"` → `AC`); pod keys are normalized
  by stripping a `-SRV`/`-DC` suffix (`pod01`, `POD02`, `POD02-SRV` → `pod01`/`pod02`); a missing
  `reason` is stored as JSON `null`; unknown family / bad `verifiedAt` / non-boolean `completed` /
  no recognizable pod all 400. Note that if `POD02` **and** `POD02-SRV` appear in the *same* payload
  the later key overwrites the earlier one rather than merging their labs — push one key per pod.
- **Making the fallback falsifiable** (this is the whole point of the feature): point
  `TRAINING_TRACKER_BASE_URL` at a dead port (e.g. `http://127.0.0.1:59999`), `truncate
  awx_verifier_progress`, **and delete the active cohort's `cohort_progress_snapshots` row** — a
  stale stored snapshot otherwise masks the fallback. Baseline `/admin/progress` must then read
  `0/0 labs` with every pod `No data`. Push payloads whose arithmetic you can predict and assert the
  exact summary/per-family cells (e.g. 3 families over 2 pods → `4/6 labs`, `2/3` per pod, family
  columns `AC`/`SC`/`IA`), plus the `Last verified` line = max pushed `verifiedAt` in
  America/New_York. Column order follows the merged course map, not alphabetical — assert the set.
- For "the tracker still wins", run a tiny fake tracker serving `/api/training-status`
  (`{pods:{pod01:{...}}, courses:{...}, last_run:...}`) on another port, repoint
  `TRAINING_TRACKER_BASE_URL`, and **restart the dev server** (`fetchLiveCohortSnapshot` uses
  `next: { revalidate: 45 }`, so an in-place reload can serve cached tracker data). Tracker-sourced
  standings show only the tracker's families and its `last_run` as `Last verified`.
- Frozen-snapshot protection is at the **stored-row** level: `/api/integrations/tracker/snapshot`
  answers `{"reason":"already_final"}` and leaves `md5(pods::text)` byte-identical. The *active*
  cohort's page still renders live/fallback numbers even when its own snapshot row is `final`, so
  assert freezing on a past cohort tab (`Cohort snapshot` heading) plus the DB md5, not on the
  active cohort's live standings.
- Repo migrations are additive and a long-lived local stack can be missing an *older* one: this run
  hit `Could not find the table 'public.student_cohort_ratings'` on `/admin/progress`. Fix by piping
  the specific file in: `docker exec -i supabase_db_… psql -U postgres -d postgres -v ON_ERROR_STOP=1
  < supabase/migrations/<file>.sql`. If a page 500s on a missing table, look for an unapplied
  migration before suspecting the PR.
- Restarting the dev server inside a single `exec` call that also `pkill`s it tends to kill the new
  process too; start it with `setsid nohup /tmp/start-prNN.sh >log 2>&1 </dev/null &` in a separate
  call. Note the log is truncated by each restart, so do secret-leak greps against a log you know
  spans the requests you care about.

## Lab pod credentials (`/admin/lab-credentials`, `/student/start` Lab Access)

- Requires `LAB_CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 32`, must decode to exactly 32
  bytes) and `LAB_INTEGRATION_SECRET` in `.env.local`, otherwise the feature errors on purpose.
- **Shell-exported env beats `.env.local`.** If a previous run exported `LAB_INTEGRATION_SECRET`,
  the dev server uses that and the bearer route answers 401 even though the file looks right.
  Start the server from a wrapper that `unset`s the LAB_* vars first, or check
  `tr '\0' '\n' < /proc/<pid>/environ | grep LAB_`.
- Tables `lab_pod_credentials` / `lab_credential_events` have RLS on with **no policies**; query
  them with `docker exec supabase_db_drcc-lab-companion psql -U postgres -d postgres`.
- There is no "create" UI: the only way a password comes into existence is the staff **Rotate**
  button, and the only way to learn the plaintext without the UI is the bearer GET on
  `/api/integrations/lab-credentials/rotations`. That makes a falsifiable chain — the value a
  student later reveals must be byte-identical to what the bridge GET returned. Generated
  passwords look like `<Word>-<6 chars>-<2 digits>`, so a stale/other-seat value is obvious.
- First issuance logs audit action `store`, **not** `rotate`; `rotate` only appears when rotating a
  seat that already had a credential. Expect all four of `store/rotate/reveal/push` only after
  rotating an already-issued seat.
- Tampering test that actually works: patch `window.fetch` to capture the `Next-Action` header the
  Show button sends, then re-POST the same action id from the same session with body `[1]`
  (another seat). The student action takes no args and derives the seat server-side, so the
  response should still be the caller's own seat. Read the response by `console.log`-ing it — the
  browser tool returns `{}` for promise results.
- Assert secrecy against the **served HTML** (`fetch(..., {credentials:'include'}).then(r=>r.text())`
  and check `.includes(password)`), not the DOM.
- **Two encrypted slots.** `secret_*` is the password the lab currently accepts (live); `pending_*`
  plus `pending_rotated_at` is a staged rotation. A rotation writes only the pending slot and sets
  `status='pending_push'`; the bridge ack promotes pending -> live and clears pending. The key
  continuity scenario to test on any change here: rotate an **already pushed** seat, then check the
  student page — the student must still see the OLD live password (not a refusal, not the staged
  one). Prove it by comparing against the distinct staged value the bearer GET returns.
- Reveal refusals should key off `password === null` (no live slot yet), not merely
  `status='pending_push'`. A refused reveal must write **no** `reveal` audit row; check with
  `select count(*) from lab_credential_events where action='reveal' and created_at < (select
  min(created_at) from lab_credential_events where action='push')`.
- The pending-slot migration adds a check constraint tying slots to status, so it **fails on legacy
  `pending_push` rows** that have no pending ciphertext (`check constraint
  "lab_pod_credentials_slots_match_status" ... is violated by some row`). Locally just truncate
  `lab_credential_events` and `lab_pod_credentials` and re-apply; on a real database this may need a
  data backfill first — worth flagging.
- Reset both tables before a run so every plaintext you assert on was generated by that run.
- `localhost:3000` vs `127.0.0.1:3000`: Next.js dev-origin protection can block client chunks on one
  of them (buttons then do nothing) and cookies are per-origin, so keep each actor's session on one
  origin and use `localhost` for interactive clicking if chunks fail.

## Devin Secrets Needed

- None for the local stack. `SUPABASE_ACCESS_TOKEN` is only needed for **read-only** production
  schema comparison; never use it to mutate production.
