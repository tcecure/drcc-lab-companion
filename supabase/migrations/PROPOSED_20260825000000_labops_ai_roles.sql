-- PROPOSED — NOT APPLIED. Renamed to 20260825000000_labops_ai_roles.sql only after
-- approval (see docs/labops-ai/checkpoint-migrations-rls.md). Reviewed against the live
-- DRCC project (kkacbtkacadgsnbylkti) schema on 2026-08-24.
--
-- Adds the LabOps AI staff roles and the helper predicates every ai_* policy uses.
-- Existing roles (student, approver, admin) are left in place; existing admins keep
-- full access by also receiving super_admin, so no staff account loses anything.

insert into public.roles (role_name, description)
values
  ('super_admin',     'LabOps AI: full control — model config, tool allow-lists, limits, all approvals.'),
  ('lab_admin',       'LabOps AI: run investigations and approve lab remediation.'),
  ('developer',       'LabOps AI: run investigations and propose code changes; cannot approve own work.'),
  ('support_analyst', 'LabOps AI: triage support requests and run investigations.')
on conflict (role_name) do nothing;

-- Existing global administrators become LabOps super admins.
insert into public.user_roles (user_id, role_id, assigned_by)
select ur.user_id, sa.id, ur.assigned_by
from public.user_roles ur
join public.roles admin_role on admin_role.id = ur.role_id and admin_role.role_name = 'admin'
cross join (select id from public.roles where role_name = 'super_admin') sa
where not exists (
  select 1 from public.user_roles existing
  where existing.user_id = ur.user_id and existing.role_id = sa.id
);

-- Which roles the current session holds. security definer so policies can read
-- user_roles/roles without granting the caller direct select on them.
create or replace function public.labops_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r.role_name), array[]::text[])
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
    and (ur.expires_at is null or ur.expires_at > now());
$$;

-- Authorized to see anything in LabOps AI at all. student is never included, and a
-- user with no role row gets false: default deny.
create or replace function public.labops_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.labops_roles() && array[
    'super_admin','lab_admin','developer','support_analyst','approver','admin'
  ];
$$;

-- Approver side of the four-eyes rule (never the requester — enforced per policy).
create or replace function public.labops_can_approve()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.labops_roles() && array['super_admin','lab_admin','approver','admin'];
$$;

revoke all on function public.labops_roles() from public;
revoke all on function public.labops_is_staff() from public;
revoke all on function public.labops_can_approve() from public;
grant execute on function public.labops_roles() to authenticated;
grant execute on function public.labops_is_staff() to authenticated;
grant execute on function public.labops_can_approve() to authenticated;

comment on function public.labops_is_staff() is
  'True when the current user holds a LabOps AI staff role. Students and role-less users are denied.';
