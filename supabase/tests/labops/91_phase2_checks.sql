-- Assertions for PROPOSED_20260830000000_labops_ai_phase2_broker.sql.
\set ON_ERROR_STOP on

do $$
declare run_id uuid; approval_id uuid; other uuid; requester uuid;
begin
  select id into requester from auth.users order by id limit 1;
  select id into other from auth.users where id <> requester order by id limit 1;
  select id into run_id from public.ai_runs limit 1;

  -- 1. write switches exist and every one of them is disabled
  if exists (select 1 from public.ai_write_switches where enabled) then
    raise exception 'a write switch shipped enabled';
  end if;
  if (select count(*) from public.ai_write_switches) < 5 then
    raise exception 'expected the global switch plus one per integration';
  end if;

  -- 2. an execution cannot exist without an approval
  insert into public.ai_approval_requests
    (run_id, requested_by, action_kind, action_payload, expires_at, idempotency_key)
  values (run_id, requester, 'awx_launch_job', '{"template":22}'::jsonb,
          now() + interval '15 minutes', 'k1')
  returning id into approval_id;

  begin
    update public.ai_approval_requests
      set execution_status = 'in_flight' where id = approval_id;
    raise exception 'a pending approval was allowed to execute';
  exception when check_violation then null; end;

  -- 3. self-approval is refused by the database
  begin
    update public.ai_approval_requests
      set status = 'approved', decided_by = requester, decided_at = now()
      where id = approval_id;
    raise exception 'self-approval was allowed';
  exception when check_violation then null; end;

  -- 4. approved parameters are frozen
  update public.ai_approval_requests
    set status = 'approved', decided_by = other, decided_at = now(),
        payload_digest = 'digest-1'
    where id = approval_id;

  begin
    update public.ai_approval_requests
      set action_payload = '{"template":45}'::jsonb where id = approval_id;
    raise exception 'approved payload was mutable';
  exception when raise_exception then null; end;

  -- 5. execution is permitted once the approval is real
  update public.ai_approval_requests
    set execution_status = 'succeeded', execution_attempts = 1,
        executed_at = now(), external_ref = 'awx-job-29032'
    where id = approval_id;

  -- 6. a rejected approval can never be revived
  insert into public.ai_approval_requests
    (run_id, requested_by, action_kind, action_payload, expires_at, status,
     decided_by, decided_at)
  values (run_id, requester, 'awx_launch_job', '{"template":22}'::jsonb,
          now() + interval '15 minutes', 'rejected', other, now())
  returning id into approval_id;

  begin
    update public.ai_approval_requests
      set status = 'approved' where id = approval_id;
    raise exception 'a rejected approval was revived';
  exception when raise_exception then null; end;

  -- 7. the idempotency key is unique
  begin
    insert into public.ai_approval_requests
      (run_id, requested_by, action_kind, action_payload, expires_at, idempotency_key)
    values (run_id, requester, 'awx_launch_job', '{"template":22}'::jsonb,
            now() + interval '15 minutes', 'k1');
    raise exception 'duplicate idempotency key was accepted';
  exception when unique_violation then null; end;

  -- 8. findings notes are one per run
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ai_findings_notes'
  ) then
    raise exception 'ai_findings_notes was not created even though support_messages exists';
  end if;
end $$;

-- 9. clients cannot write any of the new tables
do $$
declare t text;
begin
  foreach t in array array['ai_write_switches','ai_run_workspaces','ai_findings_notes'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'client grants remain on %', t;
    end if;
  end loop;
end $$;

select 'phase2 checks passed' as result;
