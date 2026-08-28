-- Portal-first support workflow. public.support_requests remains the
-- authoritative ticket table used by LabOps; this migration adds the fields
-- and child records needed for student/admin conversations.

alter table public.support_requests
  alter column user_id drop not null,
  add column if not exists requester_name text,
  add column if not exists requester_email text,
  add column if not exists lab_family text,
  add column if not exists pod_name text,
  add column if not exists last_message_at timestamptz not null default now();

update public.support_requests request
set
  requester_name = coalesce(request.requester_name, profile.full_name),
  requester_email = coalesce(request.requester_email, profile.email)
from public.profiles profile
where profile.id = request.user_id
  and (request.requester_name is null or request.requester_email is null);

alter table public.support_requests
  drop constraint if exists support_requests_category_check;

alter table public.support_requests
  add constraint support_requests_category_check check (
    category in (
      'account_access',
      'connectivity',
      'guacamole',
      'vpn',
      'lab_guide',
      'verification',
      'course_platform',
      'other'
    )
  ),
  drop constraint if exists support_requests_lab_family_check;

alter table public.support_requests
  add constraint support_requests_lab_family_check check (
    lab_family is null or lab_family in ('AC', 'IA', 'SI', 'SC', 'MP', 'PE')
  );

create index if not exists support_requests_status_last_message_idx
  on public.support_requests (status, last_message_at desc);

create index if not exists support_requests_user_last_message_idx
  on public.support_requests (user_id, last_message_at desc)
  where user_id is not null;

create index if not exists support_requests_requester_email_created_idx
  on public.support_requests (lower(requester_email), created_at desc)
  where requester_email is not null;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null
    references public.support_requests (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('requester', 'staff', 'system')),
  body text not null check (char_length(body) between 1 and 10000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint support_messages_internal_staff_only check (
    not is_internal or author_role in ('staff', 'system')
  )
);

create index if not exists support_messages_request_created_idx
  on public.support_messages (support_request_id, created_at);

create table if not exists public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  support_message_id uuid not null
    references public.support_messages (id) on delete cascade,
  uploaded_by uuid references auth.users (id) on delete set null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  size_bytes integer not null check (size_bytes between 1 and 3145728),
  created_at timestamptz not null default now()
);

create index if not exists support_attachments_message_idx
  on public.support_attachments (support_message_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'support-attachments',
  'support-attachments',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.support_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles user_role
    join public.roles role on role.id = user_role.role_id
    where user_role.user_id = auth.uid()
      and role.role_name = 'admin'
      and (user_role.expires_at is null or user_role.expires_at > now())
  );
$$;

revoke all on function public.support_user_is_admin() from public;
grant execute on function public.support_user_is_admin() to authenticated;

create or replace function public.touch_support_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists support_request_touch_updated_at
  on public.support_requests;

create trigger support_request_touch_updated_at
  before update on public.support_requests
  for each row
  execute function public.touch_support_request_updated_at();

create or replace function public.touch_support_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_requests
  set
    last_message_at = greatest(last_message_at, new.created_at),
    status = case
      when new.author_role = 'requester'
        and status in ('waiting_on_student', 'resolved')
      then 'open'
      else status
    end,
    resolved_at = case
      when new.author_role = 'requester'
        and status in ('waiting_on_student', 'resolved')
      then null
      else resolved_at
    end
  where id = new.support_request_id;

  return new;
end;
$$;

drop trigger if exists support_message_touch_conversation
  on public.support_messages;

create trigger support_message_touch_conversation
  after insert on public.support_messages
  for each row
  execute function public.touch_support_conversation();

alter table public.support_requests enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_attachments enable row level security;

-- support_requests predates this workflow. Replace any legacy policies so an
-- older broad read rule cannot be ORed with the student-own-ticket boundary.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'support_requests'
  loop
    execute format(
      'drop policy if exists %I on public.support_requests',
      existing_policy.policyname
    );
  end loop;
end;
$$;

drop policy if exists "students read own support requests"
  on public.support_requests;
create policy "students read own support requests"
  on public.support_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "students create own support requests"
  on public.support_requests;
create policy "students create own support requests"
  on public.support_requests
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "admins manage support requests"
  on public.support_requests;
create policy "admins manage support requests"
  on public.support_requests
  for all
  to authenticated
  using ((select public.support_user_is_admin()))
  with check ((select public.support_user_is_admin()));

drop policy if exists "students read own support messages"
  on public.support_messages;
create policy "students read own support messages"
  on public.support_messages
  for select
  to authenticated
  using (
    not is_internal
    and exists (
      select 1
      from public.support_requests request
      where request.id = support_request_id
        and request.user_id = (select auth.uid())
    )
  );

drop policy if exists "students add own support messages"
  on public.support_messages;
create policy "students add own support messages"
  on public.support_messages
  for insert
  to authenticated
  with check (
    author_user_id = (select auth.uid())
    and author_role = 'requester'
    and not is_internal
    and exists (
      select 1
      from public.support_requests request
      where request.id = support_request_id
        and request.user_id = (select auth.uid())
    )
  );

drop policy if exists "admins manage support messages"
  on public.support_messages;
create policy "admins manage support messages"
  on public.support_messages
  for all
  to authenticated
  using ((select public.support_user_is_admin()))
  with check ((select public.support_user_is_admin()));

drop policy if exists "students read own support attachments"
  on public.support_attachments;
create policy "students read own support attachments"
  on public.support_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.support_messages message
      join public.support_requests request
        on request.id = message.support_request_id
      where message.id = support_message_id
        and not message.is_internal
        and request.user_id = (select auth.uid())
    )
  );

drop policy if exists "admins manage support attachments"
  on public.support_attachments;
create policy "admins manage support attachments"
  on public.support_attachments
  for all
  to authenticated
  using ((select public.support_user_is_admin()))
  with check ((select public.support_user_is_admin()));

revoke all on public.support_requests from anon;
revoke update, delete on public.support_requests from authenticated;
grant select, insert on public.support_requests to authenticated;

revoke all on public.support_messages from anon;
revoke update, delete on public.support_messages from authenticated;
grant select, insert on public.support_messages to authenticated;

revoke all on public.support_attachments from anon;
revoke update, delete on public.support_attachments from authenticated;
grant select on public.support_attachments to authenticated;

comment on table public.support_messages is
  'Portal-only conversation for a support request. Internal notes are hidden from students.';
comment on table public.support_attachments is
  'Metadata for private screenshots stored in the support-attachments bucket.';
