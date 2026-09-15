# Community Impact (Moodle)

Admin-only page at `/admin/community-impact`, backed by a read-only projection of
the Moodle LMS at `https://crc.lms.tcecure.com`. This view is aggregate and
PII-free; per-student operational and security detail lives in the admin-only
Live Operations view — see [live-operations.md](live-operations.md).

## Metrics

- **Students Enrolled — All Time** — distinct Moodle user IDs ever observed with a
  student role in a tracked course. Teachers, service and test accounts excluded;
  counted once by immutable Moodle user ID, kept after a student leaves.
- **Currently Taking Courses** — distinct students with an active (non-suspended)
  enrollment in a tracked course that Moodle does not report as completed. Course
  participation, not presence.
- **Total Course Enrollments** — distinct student/course pairs ever observed;
  re-syncing does not inflate it.
- **Courses Completed** — student/course records Moodle reports complete, plus the
  completion rate over enrollments with completion tracking. Renders
  "Completion data unavailable" when Moodle exposes no completion data.

## Moodle access

Read-only web service `DigitalRCC Portal (read only)`, service account
`svc-drcc-portal-moodle-ro`, system role `DigitalRCC Portal Read Only` (view
capabilities only). Functions used: `core_webservice_get_site_info`,
`core_course_get_courses_by_field`, `core_enrol_get_enrolled_users`,
`core_completion_get_course_completion_status`. No writes are ever issued.

Server-only environment values: `MOODLE_BASE_URL`, `MOODLE_API_TOKEN`,
`MOODLE_TRACKED_COURSE_IDS`, `MOODLE_SYNC_SECRET`, optional
`MOODLE_EXCLUDED_ACCOUNT_PATTERNS` and `MOODLE_REQUEST_TIMEOUT_MS`. The token is
never sent to the browser, logged, or stored in Supabase.

## Sync scheduling

- **Daily full** — Vercel cron on `/api/integrations/moodle/sync?mode=full`.
- **Hourly incremental** — external scheduler, because the hosting plan permits
  one cron invocation per day: `drcc-moodle-sync.timer` on the AWX host
  (192.168.1.103) calls the same route with `mode=incremental`, reading the shared
  secret from `/etc/drcc/moodle-sync.env`.
- **Sync Now** — admin-only server action on the page.

Overlapping runs are refused by `moodle_start_sync_run`, so a manual run during a
scheduled one returns `skipped: already_running`.

## Rollback

1. Disable scheduling: remove the Moodle cron entry from `vercel.json` (redeploy)
   and `systemctl disable --now drcc-moodle-sync.timer` on the AWX host.
2. To disable the integration entirely, delete `MOODLE_API_TOKEN` from the Vercel
   project and redeploy; the page then renders zeros and
   "Completion data unavailable" instead of failing.
3. To remove the page, redeploy the previous production deployment in Vercel.
4. The `moodle_catalog_courses`, `moodle_learners`, `moodle_course_enrollments`,
   `moodle_progress_snapshots` and `moodle_sync_runs` tables are additive; leave
   them in place. Dropping them (plus the `moodle_roster_entries` view and the
   `moodle_*` functions) is safe but unnecessary — nothing else reads them.
5. Revoking the Moodle token in Moodle stops all access immediately and affects
   no student, auth, support or LabOps data.
