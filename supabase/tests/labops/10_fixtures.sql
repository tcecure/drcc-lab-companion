-- Local harness fixtures: pre-existing portal users/roles/tickets as they exist in
-- production before the LabOps migrations run.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'eddie@digitalrcc.com'),
  ('22222222-2222-2222-2222-222222222222', 'student03@digitalrcc.com'),
  ('33333333-3333-3333-3333-333333333333', 'approver@digitalrcc.com');

insert into public.user_roles (user_id, role_id)
select '11111111-1111-1111-1111-111111111111', id from public.roles where role_name = 'admin';
insert into public.user_roles (user_id, role_id)
select '22222222-2222-2222-2222-222222222222', id from public.roles where role_name = 'student';
insert into public.user_roles (user_id, role_id)
select '33333333-3333-3333-3333-333333333333', id from public.roles where role_name = 'approver';

insert into public.support_requests (id, user_id, category, subject, description)
values ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222',
        'connectivity', 'Cannot reach firewall', 'Pod03 firewall unreachable from DC01.');
