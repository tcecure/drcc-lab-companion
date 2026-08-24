-- Local-only harness that reproduces the parts of the DRCC Supabase project the
-- proposed LabOps migrations depend on. Never applied to any Supabase project.
create extension if not exists pgcrypto;

do $$ begin
  create role anon noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role noinherit bypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase's auth.uid() reads the request JWT claims; locally we emulate it with a
-- session setting so RLS policies can be exercised.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  role_name text not null unique,
  description text
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_by uuid references auth.users (id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  subject text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'open',
  created_at timestamptz not null default now()
);

insert into public.roles (role_name, description) values
  ('student', 'Existing portal role'),
  ('approver', 'Existing portal role'),
  ('admin', 'Existing portal role')
on conflict (role_name) do nothing;
