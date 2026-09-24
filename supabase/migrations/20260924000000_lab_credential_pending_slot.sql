-- A rotation must not take the working password away from the student while
-- AWX is still applying the new one, so a seat holds two slots: the password
-- the lab currently accepts, and the staged one waiting for the push.
alter table public.lab_pod_credentials
  alter column secret_ciphertext drop not null,
  alter column secret_nonce drop not null,
  alter column secret_tag drop not null,
  add column if not exists pending_ciphertext text,
  add column if not exists pending_nonce text,
  add column if not exists pending_tag text,
  add column if not exists pending_rotated_at timestamptz;

alter table public.lab_pod_credentials
  drop constraint if exists lab_pod_credentials_slots_match_status;

alter table public.lab_pod_credentials
  add constraint lab_pod_credentials_slots_match_status check (
    (
      status = 'pending_push'
      and pending_ciphertext is not null
      and pending_nonce is not null
      and pending_tag is not null
    )
    or (
      status = 'active'
      and pending_ciphertext is null
      and secret_ciphertext is not null
      and secret_nonce is not null
      and secret_tag is not null
    )
  );
