-- Portal-managed lab credentials.
--
-- Until now the password a student needs for Guacamole and their pod server
-- lived only inside an AWX credential (write-only) and in hand-issued PDFs,
-- so nobody could answer "what is my lab password?" without a rotation. The
-- portal becomes the system of record instead: one credential per seat, the
-- secret encrypted with AES-256-GCM under LAB_CREDENTIAL_ENCRYPTION_KEY, and
-- every reveal or rotation recorded.
--
-- The ciphertext never leaves the service role. Students read their own seat
-- through a server action that checks their assignment; staff read any seat
-- behind requireManager(). Neither path can be reached with an anon key, so
-- the tables carry RLS with no policies.
create table if not exists public.lab_pod_credentials (
  id uuid primary key default gen_random_uuid(),
  seat_number integer not null unique check (seat_number between 1 and 200),
  pod_name text not null,
  lab_username text not null,
  -- base64 AES-256-GCM ciphertext, 96-bit nonce and 128-bit tag, kept apart so
  -- the key can be rotated by re-encrypting without a schema change.
  secret_ciphertext text not null,
  secret_nonce text not null,
  secret_tag text not null,
  key_version integer not null default 1 check (key_version >= 1),
  -- active: what the lab actually accepts right now.
  -- pending_push: generated here and not yet applied to AD and Guacamole, so
  -- the student must keep using the previous one until the bridge runs.
  status text not null default 'active'
    check (status in ('active', 'pending_push')),
  rotated_at timestamptz not null default now(),
  rotated_by uuid references auth.users (id) on delete set null,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lab_pod_credentials is
  'One encrypted lab password per pod seat. Written and read only by the service role; the plaintext is returned to the owning student or to staff through server actions that log the access.';

create index if not exists lab_pod_credentials_status_idx
  on public.lab_pod_credentials (status, rotated_at desc);

alter table public.lab_pod_credentials enable row level security;

-- Who looked at or changed which seat. Deliberately not deletable from the
-- application: rotations and reveals are the audit trail staff will be asked
-- about, so they outlive the credential row.
create table if not exists public.lab_credential_events (
  id uuid primary key default gen_random_uuid(),
  seat_number integer not null check (seat_number between 1 and 200),
  action text not null
    check (action in ('store', 'rotate', 'reveal', 'push')),
  actor_role text not null
    check (actor_role in ('student', 'staff', 'integration')),
  actor_user_id uuid references auth.users (id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

comment on table public.lab_credential_events is
  'Audit trail of lab credential reveals, rotations and pushes to AD/Guacamole.';

create index if not exists lab_credential_events_seat_idx
  on public.lab_credential_events (seat_number, created_at desc);

create index if not exists lab_credential_events_created_idx
  on public.lab_credential_events (created_at desc);

alter table public.lab_credential_events enable row level security;

create or replace function public.touch_lab_pod_credentials()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();

  return new;
end;
$$;

drop trigger if exists touch_lab_pod_credentials on public.lab_pod_credentials;

create trigger touch_lab_pod_credentials
  before update on public.lab_pod_credentials
  for each row
  execute function public.touch_lab_pod_credentials();
