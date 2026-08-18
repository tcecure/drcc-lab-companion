-- Current-student test imports are for portal management only. They bypass
-- the normal invite and provisioning workflows until access is arranged.

drop trigger if exists student_cohort_assignment_enqueue_event
  on public.student_cohort_assignments;

create trigger student_cohort_assignment_enqueue_event
  after insert or update of seat_number on public.student_cohort_assignments
  for each row
  when (
    new.seat_number is not null
    and new.source <> 'silent_active_import'
  )
  execute function public.enqueue_cohort_assignment_event();
