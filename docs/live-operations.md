# Live Operations (admin) and Impact (donor-facing)

The Moodle projection now feeds two deliberately separated views:

| View | Route | Audience | Contents |
| --- | --- | --- | --- |
| **Impact** | `/admin/community-impact` | donors, staff, Presentation Mode | aggregate enrollment and completion metrics only |
| **Live Operations** | `/admin/community-impact/live` | administrators only | per-student activity, mapping and security detail |

Both are reached through the switcher at the top of either page. Impact keeps its
four metrics, roster, filters, sorting and Presentation Mode unchanged; no name,
email address, Moodle id, IP address, activity detail or Guacamole detail is
rendered in Presentation Mode.

Live Operations is **read-only monitoring**. It cannot suspend an account, close a
Guacamole session, or write anything to Moodle or Guacamole; the pages issue no
server actions and no mutating requests.

## Activity status definitions

Status comes **only** from real Moodle standard-log events collected from the LMS.
A login, an already-open Guacamole session, or an open browser tab does not make
anyone active.

| Status | Definition |
| --- | --- |
| **Active now** | newest Moodle log event within the last **15 minutes** |
| **Active within 2 hours** | newest event older than 15 minutes but within **2 hours** |
| **Active within 24 hours** | newest event within **24 hours** |
| **Active within 7 days** | newest event within **7 days** |
| **No Moodle activity in 7 days** | no learner event in 7 days, or no event at all |

Window selector (15 minutes / 2 hours / 24 hours / 7 days) changes which statuses
count as "active in window" and which per-window event count the table shows. Each
row also shows a **Last Moodle event** timestamp and event count for the window.

**Last Seen in Moodle** is separate and clearly labelled: it is Moodle's coarse
`lastaccess` / `lastcourseaccess` value from `core_enrol_get_enrolled_users`. It is
never used to compute activity status and is never presented as real-time activity.

Events excluded from activity so the portal's own polling and administrative jobs
cannot look like student work: `\core\event\webservice_function_called`, and any
event with origin `cli` or `restore`.

**Needs attention** is true when any of these hold: 3 or more failed Moodle logins
in 7 days; a Guacamole session left open for more than 24 hours (a stale record,
not a live user); or an assignment whose access window is open with zero Moodle
events in 7 days.

## Data sources

| Source | Reaches the portal via | Data |
| --- | --- | --- |
| Moodle log store | `local_drccops_get_recent_events` over the existing read-only web service | event name/component/action/target, course id, Moodle user id, origin, source IP, timestamp |
| Moodle failed logins | `local_drccops_get_failed_logins` | attempted username, reason, source IP, timestamp (including attempts on non-existent accounts) |
| Moodle enrollments/progress | existing `core_enrol_get_enrolled_users`, `core_completion_get_course_completion_status` | courses, enrollment counts, progress, `lastaccess` |
| Guacamole | lab-side collector → `POST /api/integrations/guacamole/sessions` | Guacamole username, connection name, remote host, start/end timestamps |
| Portal | existing `profiles`, `student_cohort_assignments` | portal account match, cohort, seat/pod, lab username, access window, member server (`PODxx-SRV`) |

The Moodle database is never exposed to Vercel, and no Guacamole credential exists
in the Vercel project: the portal only ever receives sanitized rows from a
lab-side collector or read-only web-service responses.

### Mapping chain

`profiles.email` ⇄ Moodle learner email → `student_cohort_assignments`
(cohort, seat, lab username, access window) → member server `POD<seat>-SRV` →
Guacamole sessions matched on the lab username. Learners with no portal account
still appear, marked as unmatched — expected, since portal accounts are not
created from Moodle.

## Required Moodle permissions

Unchanged service account `svc-drcc-portal-moodle-ro` on external service
`DigitalRCC Portal (read only)`, with system role `DigitalRCC Portal Read Only`
(`drccportalro`). Existing token is reused. Additions for this feature:

- functions `local_drccops_get_recent_events` and `local_drccops_get_failed_logins`
  added to the external service (both declared `type => read`),
- capability `local/drccops:viewactivity` allowed on the portal role.

Plugin source, deployment and rollback: `platform/moodle-plugins/local_drccops`
in `tcecure/crc-awx-labops`.

## Required Guacamole access

No web login and no admin permission. A dedicated PostgreSQL role
`guac_portal_ro` on the Guacamole database with `SELECT` on
`guacamole_connection_history` and `guacamole_connection` only — verified unable
to write history or read `guacamole_user`. Role SQL:
`platform/guacamole/portal-readonly-role.sql` in `tcecure/crc-awx-labops`.

The collector (`scripts/guacamole-session-collector/`) runs on the Guacamole host
under a systemd timer every two minutes, reads recent/open history rows, probes
the Guacamole web endpoint for reachability, and POSTs the result with
`GUACAMOLE_INGEST_SECRET`.

A row still open after 24 hours means guacd or the web application lost the
session without writing an end date, so it is **stale, not live**: it is excluded
from the live session count and from the "In a Guacamole session" filter, counts
toward needs-attention, and is named as stale in both the list (`None live · 1
stale`) and the student's session table (`Open over 24h — stale, not a live
session`), so the two views cannot disagree about who is connected.

## Refresh, caching and freshness

- The Live Operations pages are dynamic server components with no caching; every
  request reads current state.
- The list auto-refreshes every **60 seconds** and has a manual **Refresh**
  button. Filters, window and sort survive a refresh because they live in the URL.
- Moodle activity collection: `/api/integrations/moodle/activity` (secret
  protected), driven by `drcc-moodle-activity.timer` on the AWX host every 2
  minutes. It is cursor based (`sinceid` in `integration_connector_health`), so a
  failed run resumes without gaps or duplicates; `moodle_log_id` is unique.
- Connector health shows per-connector status and last success for the Moodle
  activity, Moodle sync and Guacamole connectors: **current** (< 10 min),
  **delayed** (< 60 min), **stale** (older), **unavailable** (never reported or
  failing). A failed or stale connector is stated on the page, so an outage never
  reads as an idle cohort.
- Activity events are pruned to 30 days by `moodle_prune_activity`.

## Known limitations

- Activity resolution is bounded by the 2-minute collection interval; "Active now"
  can lag real work by up to that interval.
- Moodle records events for course/activity interaction. A student working only
  inside the lab (RDP on the member server) generates Guacamole session rows but
  no Moodle events, and correctly reads as not active in Moodle.
- Guacamole rows are matched by lab username; a session opened under any other
  Guacamole account is stored but not attributed to a student.
- Failed logins for non-existent usernames have no Moodle user id, so they appear
  in the connector's totals but cannot be attributed to a learner.
- Two orphaned Guacamole history rows from February 2026 (`POD01-WS01`) remain
  open in Guacamole's history; they are reported as stale, not live, and will keep
  flagging that lab account for attention until Guacamole's history is cleaned up.
- Only the small subset of Moodle learners with a matching portal account gets
  cohort/pod/member-server mapping.
- Presentation Mode is unchanged and remains aggregate-only.

## Deployment

1. Apply `supabase/migrations/20260915000000_moodle_live_operations.sql` to
   production Supabase (additive: four tables, one view, two functions, RLS on).
2. Deploy the plugin and configure the service/role
   (`platform/moodle-plugins/local_drccops`).
3. Set `GUACAMOLE_INGEST_SECRET` in the Vercel project (server-side only) and
   redeploy.
4. Apply `platform/guacamole/portal-readonly-role.sql` on the Guacamole host and
   install `scripts/guacamole-session-collector/` at
   `/opt/drcc/guacamole-session-collector/` with
   `/etc/drcc/guacamole-session-collector.env` (chmod 600), then
   `systemctl enable --now guacamole-session-collector.timer`.
5. Install `drcc-moodle-activity.timer` on the AWX host (same pattern as
   `drcc-moodle-sync.timer`, reusing `MOODLE_SYNC_SECRET`), then
   `systemctl enable --now drcc-moodle-activity.timer`.

## Rollback

1. `systemctl disable --now drcc-moodle-activity.timer` (AWX host) and
   `systemctl disable --now guacamole-session-collector.timer` (Guacamole host).
   Collection stops; Live Operations reports the connectors as stale/unavailable.
   Impact is unaffected.
2. To remove the view, redeploy the previous production deployment in Vercel.
   Impact keeps working because it does not read any of the new tables.
3. Remove the two functions from the Moodle external service and prohibit
   `local/drccops:viewactivity`; uninstall the plugin if desired.
4. Revoke the Guacamole role:
   `revoke all on guacamole_connection_history, guacamole_connection from guac_portal_ro; drop role guac_portal_ro;`
5. The new tables (`moodle_activity_events`, `moodle_login_failures`,
   `guacamole_sessions`, `integration_connector_health`) and the
   `moodle_live_operations_entries` view are additive and read by nothing else;
   leave them or drop them. No student, authentication, support-ticket, LabOps or
   existing Moodle table is touched by this feature.
