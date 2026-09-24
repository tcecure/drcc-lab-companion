# Portal-managed lab credentials

Students used to be handed their pod password out of band, which meant staff
held a list of twenty passwords and every rotation invalidated whatever the
students had been sent. The portal is now the system of record: it stores each
seat's password encrypted, shows a student only their own, and hands rotations
to the lab through a bridge that reports back when the change is live.

## Storage

`lab_pod_credentials` holds one row per seat with two encrypted slots under
AES-256-GCM: the password the lab currently accepts (`secret_ciphertext`,
`secret_nonce`, `secret_tag`) and the one a rotation has staged but not yet
applied (`pending_ciphertext`, `pending_nonce`, `pending_tag`).
The key is `LAB_CREDENTIAL_ENCRYPTION_KEY`, 32 random bytes in base64:

```bash
openssl rand -base64 32
```

Both tables have row level security enabled with no policies, so the anon and
authenticated keys cannot read them at all. Every read goes through
`lib/lab-credentials.ts`, which is `server-only` and uses the service-role
client after the caller has been authorized.

## Who can read what

- A student's reveal takes the seat number from their own active cohort
  assignment; the client never sends a seat number, so there is no request a
  student can craft that returns another pod's password.
- Staff (`admin`, `approver`) can reveal and rotate any seat through
  `/admin/lab-credentials`.
- Passwords are never in the server-rendered HTML, a URL, an email, or a log
  line. The student page renders a button; the plaintext only crosses the wire
  in the response to an explicit reveal.

Every reveal, rotation and push is appended to `lab_credential_events` with the
actor role and user id. The audit table stores no plaintext.

## Rotation and the AWX bridge

Rotation is two-phase so that access never breaks mid-lab:

1. Staff rotate a seat. A new password is generated into the pending slot and
   the row is marked `pending_push`. The live slot is untouched, so the student
   keeps seeing the password the lab still accepts.
2. The lab-side bridge reads the pending rotations, applies them to Active
   Directory and to the pod's Guacamole connection, then acknowledges the seats.
   The pending slot is promoted into the live slot, the row flips to `active`,
   and the student sees the new password.

A seat rotated before it ever had a pushed password has an empty live slot: both
the student and staff are told the password is still being applied rather than
being handed one the lab would reject, and no reveal is recorded because nothing
was disclosed.

The bridge talks to two endpoints, both authenticated with a bearer
`LAB_INTEGRATION_SECRET` (never a query string):

```
GET  /api/integrations/lab-credentials/rotations  -> { rotations: [{ seatNumber, labUsername, podName, password }] }
POST /api/integrations/lab-credentials/rotations  <- { "seatNumbers": [2] }
```

`GET` is the only place a stored password leaves the portal in plaintext, and
only to the lab network over TLS. The AWX side keeps `no_log: true` around the
password tasks, so nothing lands in job output.

## Failure modes

- Missing or wrong-length key: credential operations throw and the admin page
  shows "Credential storage is disabled" rather than failing silently.
- Tampered or key-mismatched ciphertext: GCM authentication fails and the read
  throws; it never returns a corrupted password.
- Lost key: nothing can be decrypted. Recovery is a rotation of every seat, not
  a restore — rotate each seat and let the bridge push the new passwords.
