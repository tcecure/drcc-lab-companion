-- Student numbers (seat / pod / lab username) are no longer handed out at import
-- time. Imported students sit in the queue with these columns null until the
-- 01:00 America/New_York assignment run on their cohort start date.

alter table public.student_cohort_assignments
  alter column seat_number drop not null,
  alter column lab_username drop not null,
  alter column pod_name drop not null;

create index if not exists student_cohort_assignments_pending_seat_idx
  on public.student_cohort_assignments (cohort_number, created_at)
  where seat_number is null;
