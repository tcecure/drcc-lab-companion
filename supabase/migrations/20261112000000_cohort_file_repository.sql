-- Per-cohort file repository.
--
-- Learning reports, evidence exports and operational reports were produced
-- ad hoc and emailed as attachments, so the issued document lived nowhere a
-- student or a staff member could go back to. This gives each cohort a
-- browsable folder in the portal: staff upload and download under
-- requireManager(), a student sees only the documents filed against their own
-- user, and the bytes sit in a private storage bucket that is never public.
--
-- Everything is read and written by the service role through server actions,
-- so both tables carry RLS with no policies: an anon or authenticated key can
-- reach neither.

insert into storage.buckets (id, name, public)
values ('cohort-files', 'cohort-files', false)
on conflict (id) do nothing;

create table if not exists public.cohort_files (
  id uuid primary key default gen_random_uuid(),
  cohort_number integer not null check (cohort_number between 1 and 200),
  -- The folder a file appears under in the browser. Kept as a checked list
  -- rather than free text so the repository stays navigable: a typo would
  -- otherwise create a new folder nobody looks in.
  folder text not null
    check (folder in ('transcripts', 'evidence', 'reports')),
  file_name text not null check (length(trim(file_name)) > 0),
  -- Object key inside the private bucket. Prefixed with the row id so two
  -- uploads of the same name never collide while a replaced file is retained.
  storage_path text not null unique,
  content_type text not null default 'application/octet-stream',
  byte_size bigint not null check (byte_size >= 0),
  checksum_sha256 text,
  -- Set when the document belongs to one learner (a transcript). That student
  -- can download it; staff can see every file either way.
  student_user_id uuid references auth.users (id) on delete set null,
  description text,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Soft delete: a transcript that was issued to someone stays accountable
  -- even after staff remove it from the listing.
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

comment on table public.cohort_files is
  'Files filed under a cohort folder in the portal repository. Rows are metadata; the bytes live in the private cohort-files storage bucket.';

-- One live file per name in a folder; superseded uploads keep their row.
create unique index if not exists cohort_files_unique_live_name_idx
  on public.cohort_files (cohort_number, folder, file_name)
  where deleted_at is null;

create index if not exists cohort_files_cohort_idx
  on public.cohort_files (cohort_number, folder, created_at desc);

create index if not exists cohort_files_student_idx
  on public.cohort_files (student_user_id, created_at desc)
  where student_user_id is not null and deleted_at is null;

alter table public.cohort_files enable row level security;

-- Who uploaded, downloaded or removed which document. Downloads matter here:
-- transcripts name a learner and their results, so "who took a copy" is a
-- question staff will be asked.
create table if not exists public.cohort_file_events (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references public.cohort_files (id) on delete set null,
  cohort_number integer not null,
  action text not null check (action in ('upload', 'download', 'delete')),
  actor_role text not null
    check (actor_role in ('student', 'staff', 'integration')),
  actor_user_id uuid references auth.users (id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

comment on table public.cohort_file_events is
  'Access trail for the cohort file repository: upload, download and removal, with the role that did it.';

create index if not exists cohort_file_events_file_idx
  on public.cohort_file_events (file_id, created_at desc);

alter table public.cohort_file_events enable row level security;
