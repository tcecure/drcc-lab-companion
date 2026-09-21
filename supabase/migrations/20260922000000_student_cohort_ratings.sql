-- Staff-assigned performance rating for a student in a finished cohort.
--
-- The tracker already scores labs pass/fail, but two students can both finish
-- 56/56 and still be very different candidates. This is the human judgement
-- on top of that: one 1-5 rating per student per cohort, set by staff on
-- /admin/progress and shown beside the name in the standings.
--
-- Kept in its own table rather than on student_cohort_assignments so the
-- rating survives independently of seating, and so a cohort whose standings
-- come from a frozen snapshot can still be rated afterwards.
create table if not exists public.student_cohort_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cohort_number integer not null check (cohort_number >= 1),
  rating smallint not null check (rating between 1 and 5),
  note text,
  rated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cohort_number)
);

comment on table public.student_cohort_ratings is
  'Staff 1-5 rating of a student''s performance in one cohort. Written only by the service role from admin server actions; never exposed to students.';

create index if not exists student_cohort_ratings_cohort_idx
  on public.student_cohort_ratings (cohort_number, rating desc);

-- Service role only. Staff read and write it through the admin client behind
-- requireManager(); students must never see their own or anyone else's rating.
alter table public.student_cohort_ratings enable row level security;

create or replace function public.touch_student_cohort_ratings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();

  return new;
end;
$$;

drop trigger if exists touch_student_cohort_ratings
  on public.student_cohort_ratings;

create trigger touch_student_cohort_ratings
  before update on public.student_cohort_ratings
  for each row
  execute function public.touch_student_cohort_ratings();
