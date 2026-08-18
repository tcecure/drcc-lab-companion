-- The queue-first intake inserts assignments with a null seat, so the outbox
-- event must fire when the student number is actually handed out rather than at
-- insert time (where pod_name / lab_username / seat_number are still null).
-- The idempotency key is per assignment, so a row inserted with a seat already
-- set still emits exactly one event.

drop trigger if exists student_cohort_assignment_enqueue_event
  on public.student_cohort_assignments;

create trigger student_cohort_assignment_enqueue_event
  after insert or update of seat_number on public.student_cohort_assignments
  for each row
  when (new.seat_number is not null)
  execute function public.enqueue_cohort_assignment_event();
