# Per-cohort progress snapshots

The AWX training tracker (`https://training.status.tcecure.com`) grades live
infrastructure state, so it only ever describes the cohort currently sitting in
the pods. Resetting and reseeding the six lab families for the next cohort
erases the previous cohort's standings. `/admin/progress` therefore keeps a
per-cohort snapshot so a finished cohort stays readable and rankable.

## Model

- One row per cohort in `public.cohort_progress_snapshots` (RLS on, service role
  only; staff read it through the admin client).
- `status = 'interim'` while the cohort's access window is open: the row is
  overwritten from the tracker on every capture.
- `status = 'final'` once the access window has closed: the row is frozen and
  never written again, which is what makes it a point-in-time record.
- `pods` is `{ "pod01": { "<labId>": { "completed": bool, "reason": text } } }`
  and `courses` is the tracker's family map (`AC`, `IA`, `SI`, `SC`, `MP`, `PE`),
  so a lab's family is resolved from the snapshot itself rather than from
  today's tracker configuration.
- `waived_labs` lists lab ids excluded from scoring because they were not real
  student work in that cohort. Cohort 1 carries `["M3-L2"]`: the IA M3-L2
  domain password-policy waiver read complete on every pod, including pods
  nobody was assigned to. Scoring drops those labs from both the numerator and
  the denominator, so an untouched pod reads 0, not 1.

## Page behavior

`/admin/progress` renders one tab per cohort that has seats or a snapshot,
newest first, and defaults to the active cohort.

- Active cohort: standings are computed from a live tracker read (falling back
  to the stored interim row if the tracker is unreachable), and selecting a
  student still embeds that pod's tracker page.
- Finished cohort: standings come from the frozen snapshot, and selecting a
  student lists the labs they did not complete with the verifier's reason.

Ranking is by graded labs completed, then pod number. Outcomes are
`Completed all`, `In progress`, `Not started`, and `No data` (a rostered pod
absent from the snapshot).

## Capture schedule

`POST /api/integrations/tracker/snapshot` captures the active cohort and
finalizes any cohort whose window has closed. It authenticates with
`TRACKER_SNAPSHOT_SECRET` (falling back to `CRON_SECRET`) as a bearer token or
a `?secret=` parameter, and is never called from the browser.

The hosting plan allows one Vercel cron per day, and both slots are taken by
cohort assignment and the Moodle full sync, so the frequent run comes from the
same external scheduler used for the hourly Moodle incremental sync (a systemd
timer on the AWX host). Hourly is enough: the last interim capture before a
window closes becomes that cohort's final snapshot, so it lands within an hour
of the cohort ending and always before the next cohort's reset.

Re-running the route is safe. A `final` row is never rewritten, so a late or
repeated call cannot overwrite a frozen cohort with post-reset state.

## Backfilling a cohort that was never captured

Cohort 1 closed before this feature existed and its pods have since been reset.
Its snapshot was reconstructed from the AWX verify job artifacts of the last
scheduled run before the reset (2026-08-31 23:41–23:55 UTC, one job per
family), inserted with `status = 'final'`, `source = 'awx_job_artifacts'` and
`waived_labs = ["M3-L2"]`. Any future backfill follows the same shape: the
artifacts of the last pre-reset verify job per family, keyed by `podNN`.

## Rollback

The feature is additive.

- To hide it, revert the application commit: the page falls back to the live
  tracker view and the table is simply unread.
- To remove the data, `drop table public.cohort_progress_snapshots;`. Nothing
  else references it, and no existing table, view, or policy was modified.
