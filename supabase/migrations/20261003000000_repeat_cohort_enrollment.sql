-- A learner may come back in a later cohort. The table was unique on user_id,
-- which made a returning learner's history and their new seat mutually
-- exclusive: enrolling them again could only overwrite the finished row.
-- One row per learner per cohort instead, so completed cohorts stay intact.
alter table public.student_cohort_assignments
  drop constraint if exists student_cohort_assignments_user_id_key;

create unique index if not exists student_cohort_assignments_user_cohort_key
  on public.student_cohort_assignments (user_id, cohort_number);
