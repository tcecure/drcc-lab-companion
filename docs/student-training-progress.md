# Student training progress

The student dashboard and `/student/training` show read-only lab progress for the
student's own pod. Progress comes from the training tracker's authenticated
per-pod endpoint; the portal never receives lab credentials, passwords, or other
pods' data.

## Data flow

```
student_cohort_assignments.pod_name  ->  pod number (01-20)
  ->  server-side GET https://training.status.tcecure.com/api/v1/pods/<NN>/progress
      Authorization: Bearer <TRAINING_TRACKER_API_TOKEN>
  ->  validated payload rendered on /student and /student/training
```

The fetch happens in a server component only, so the bearer token is never sent
to the browser and no CORS or CSP change is needed. Responses are never cached
(`cache: "no-store"`, `dynamic = "force-dynamic"`), with an 8 second timeout.

## Environment variables

| Name | Purpose |
| --- | --- |
| `TRAINING_TRACKER_BASE_URL` | Tracker origin, defaults to `https://training.status.tcecure.com` |
| `TRAINING_TRACKER_API_TOKEN` | Read-only bearer token, matches `POD_PROGRESS_API_TOKEN` on the tracker host |

Both are set for production, preview, and development in the `drcc-web` Vercel
project. The token is stored as a sensitive variable and is rotated by changing
`POD_PROGRESS_API_TOKEN` on the tracker host first, then this value.

## Behavior when the tracker cannot be read

A missing token, HTTP error, timeout, or malformed payload renders an
"unavailable" state that explicitly says progress could not be read. It is never
rendered as a confirmed zero percent, so a tracker outage cannot look like lost
student work. A student without an assigned seat sees a pending message instead.

Payload validation (`lib/training-progress.ts`) rejects any response whose
`studentNumber` differs from the requested pod, whose status is outside
`not_started | in_progress | completed | unavailable`, or whose percentages are
not integers between 0 and 100.
