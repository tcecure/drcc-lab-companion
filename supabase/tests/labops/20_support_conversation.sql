-- Production-shaped ticket conversation tables, so the Phase 2 broker migration is
-- validated against what production actually has (see checkpoint-schema-reconciliation.md).
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('requester','staff','system')),
  body text not null check (char_length(body) between 1 and 10000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint support_messages_internal_staff_only
    check (not is_internal or author_role in ('staff','system'))
);

create table if not exists public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  support_message_id uuid not null references public.support_messages (id) on delete cascade,
  uploaded_by uuid references auth.users (id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

alter table public.support_requests
  add column if not exists requester_name text,
  add column if not exists requester_email text,
  add column if not exists lab_family text,
  add column if not exists pod_name text,
  add column if not exists last_message_at timestamptz not null default now();
