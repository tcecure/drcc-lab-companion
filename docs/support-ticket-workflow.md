# Portal Support Workflow

DigitalRCC support is portal-first. Email notifies people that a ticket changed;
the ticket conversation remains in Supabase.

## Student flow

1. The public `/support` page remains the known-issues source.
2. Signed-in students open `/student/support/new`.
3. The portal fills the student identity and pod from Supabase.
4. The student selects a category and optional lab family, describes the issue,
   and can attach one PNG, JPEG, or WebP screenshot up to 3 MB.
5. Replies continue on `/student/support/[id]`.
6. A student reply reopens a ticket that was resolved or waiting on the student.

Students who cannot sign in use `/support/request`. That limited public form
creates an `account_access` ticket, uses a hidden bot trap, enforces a minimum
completion time, and limits each email address to three requests per day.

## Staff flow

Admins use `/admin/support` to filter the queue and open a ticket. From the
ticket page they can:

- assign the ticket to themselves;
- set status and priority;
- reply to the requester;
- add an internal note that is never shown or emailed to the student; and
- open private screenshot links that expire after one hour.

Approvers do not receive ticket access. The feature follows the current
admin-only user-management boundary.

## Google Workspace mail

Create `support@digitalrcc.com` as an alias of the licensed
`admin@digitalrcc.com` account. Add the alias to Gmail's **Send mail as** list
with this display name:

```text
Digital Resilience Community Clinic Support
```

Create a Gmail filter or Workspace routing rule for mail addressed to
`support@digitalrcc.com` and forward it to `cyberlab@tcecure.com`. This is a
fallback for accidental email replies; those replies are not imported into the
portal ticket.

Create a separate Google app password named `DRCC Portal Support`. Add these
Vercel variables to Production and Preview, then redeploy:

```text
SUPPORT_EMAIL_DELIVERY_MODE=live
SUPPORT_EMAIL=support@digitalrcc.com
SUPPORT_NOTIFY_EMAIL=cyberlab@tcecure.com
SUPPORT_FROM_NAME=Digital Resilience Community Clinic Support
SUPPORT_SMTP_HOST=smtp.gmail.com
SUPPORT_SMTP_PORT=465
SUPPORT_SMTP_USER=admin@digitalrcc.com
SUPPORT_SMTP_PASSWORD=<app password without spaces>
```

Support email is attempted after the portal response is committed. A failed
delivery is retained in `email_jobs` for retry and does not discard the ticket
or reply. This support-only switch does not enable cohort or import email;
`EMAIL_DELIVERY_MODE` continues to control those existing jobs separately.

## Database deployment

Run this migration in the same Supabase project used by the portal:

```text
supabase/migrations/20260828000000_support_ticket_portal.sql
```

The migration extends the existing `support_requests` table, creates
`support_messages` and `support_attachments`, adds student/admin RLS policies,
and creates the private `support-attachments` Storage bucket.
