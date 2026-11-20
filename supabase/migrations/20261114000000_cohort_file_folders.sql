-- Separate the course material and the issued certificates from transcripts.
--
-- The repository started with transcripts / evidence / reports. A cohort's
-- guide PDFs are course material and must not sit in the same folder as the
-- records issued to a learner, and a completion certificate is its own
-- document rather than a transcript, so both get their own folder.

alter table public.cohort_files
  drop constraint if exists cohort_files_folder_check;

alter table public.cohort_files
  add constraint cohort_files_folder_check
  check (
    folder in (
      'transcripts',
      'certificates',
      'evidence',
      'guides',
      'reports'
    )
  );
