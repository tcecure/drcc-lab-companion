# DigitalRCC Supabase email templates

These templates are designed for the hosted Supabase email editor. They use
table layouts, inline styles, and Supabase Go-template variables for broad
email-client compatibility.

## Invite user

- Dashboard location: Authentication > Email Templates > Invite user
- Subject: `Welcome to the DigitalRCC Lab Companion`
- Body: `invite.html`
- Application route: `/auth/invite`

The invite link intentionally opens a confirmation page before Supabase
verifies the one-time token. This protects the invitation from email-security
systems that prefetch links.

## Reset password

- Dashboard location: Authentication > Email Templates > Reset password
- Subject: `Reset your DigitalRCC password`
- Body: `recovery.html`
- Application route: `/auth/recovery`

## Required Supabase settings

- Site URL: `https://my.digitalrcc.com`
- Sender name: `Digital Resilience Community Clinic`
- Sender address: `no-reply@digitalrcc.com`
- Reply-to/support address: `support@digitalrcc.com`

After changing a template, send a new invitation or reset message. Previously
issued one-time links continue using the old message and should not be reused.
