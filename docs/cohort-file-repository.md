# Cohort file repository

Learning reports, evidence exports and cohort reports used to be produced on
demand and emailed as attachments, so the issued document existed nowhere a
student or a staff member could return to. The portal now carries a browsable
repository: one folder per cohort, three folders inside it, and a download path
that knows who is asking.

## Layout

```
/admin/files                       every cohort, newest first
/admin/files/<cohort>              Transcripts · Lab Evidence · Cohort Reports
/admin/files/<cohort>/<folder>     the files, with upload and remove
/student/documents                 the documents filed against that student
```

Folders are a fixed list (`transcripts`, `evidence`, `reports`) rather than
free text: a typo would otherwise create a folder nobody looks in.

## Storage and access

The bytes live in the private `cohort-files` Supabase bucket under
`cohort-NN/<folder>/<row id>-<file name>`; `cohort_files` holds the metadata
and `cohort_file_events` the access trail. Both tables have RLS enabled with no
policies, so the anon and authenticated keys cannot read them — everything goes
through `lib/cohort-files.ts` (`server-only`, service role) after the caller has
been authorized.

- Staff (`admin`, `approver`) browse, upload, download and remove any file.
- A student can download only a file whose `student_user_id` is their own, and
  sees nothing else in the repository. `/api/files/<id>` enforces this on the
  server, so a guessed id returns 404 rather than someone else's transcript.
- Downloads are brokered: the route mints a 60-second signed URL and redirects.
  A link that leaks stops working within the minute.
- Uploads are capped at 50 MB and the file name is sanitized, so `../` in a
  name cannot escape the cohort prefix.
- The bytes never travel through the app. The browser asks for a one-shot
  signed upload ticket, puts the file straight into the private bucket, then
  calls `registerCohortFileAction` with only the metadata. A request body
  carrying the file is truncated at 10 MB by the hosting runtime, so an upload
  through a server action fails well below the documented cap. Registration
  reads the size and type back from storage rather than trusting the browser,
  and deletes an object that is empty, oversized or misplaced instead of
  leaving it orphaned.

Upload, download and removal are each appended to `cohort_file_events` with the
actor's role and user id. "Who took a copy of this transcript" is answerable.

## Replacing and removing

Uploading a name that already exists in the folder replaces it: the new row
becomes the live one and the previous row is soft-deleted, so the folder shows
one current copy while the superseded document stays in the trail. Removing a
file deletes the object from the bucket and soft-deletes the row; the event
history survives either way.

## Publishing a transcript

Generate the report, then upload it to the cohort's **Transcripts** folder and
pick the student in the *Belongs to* list. That single step both files it under
the cohort and makes it appear on that learner's **My Documents** page. A
report that belongs to no one (funder reporting, a cohort summary) goes in
**Cohort Reports** and stays staff-only.

## Migration

`supabase/migrations/20261112000000_cohort_file_repository.sql` creates the two
tables and inserts the private bucket row. It is additive and safe to re-run.
