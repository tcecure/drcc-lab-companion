-- Behavioural checks for the Phase 2 broker objects, run against production.
-- Every row it writes is rolled back: the block ends by raising, and the Management API
-- executes the whole script in one transaction, so nothing survives. The results travel
-- back inside the exception message because a rolled-back select cannot return rows.
do $$
declare
  res text := '';
  sr uuid;
  u1 uuid;
  u2 uuid;
  r uuid;
  a uuid;
  ok boolean;
begin
  select id into sr from public.support_requests order by created_at limit 1;
  select id into u1 from auth.users order by created_at limit 1;
  select id into u2 from auth.users order by created_at desc limit 1;
  if sr is null or u1 is null then
    raise exception 'CHECKS: no support_request or auth user to anchor the fixtures';
  end if;

  insert into public.ai_runs (support_request_id, requested_by, status, title,
    sanitized_context, model, provider, token_budget, wallclock_limit_seconds)
  values (sr, u1, 'queued', 'phase2 rollback probe', '{}'::jsonb, 'gpt-5-mini', 'openai', 1000, 60)
  returning id into r;

  -- 1. self-approval
  begin
    insert into public.ai_approval_requests (run_id, requested_by, action_kind, action_payload,
      status, decided_by, decided_at, expires_at)
    values (r, u1, 'awx_job', '{"template":1}'::jsonb, 'approved', u1, now(), now() + interval '1 hour');
    res := res || E'FAIL self-approval accepted\n';
  exception when check_violation then res := res || E'PASS self-approval denied\n';
  end;

  -- 2. execution requires an approved decision
  begin
    insert into public.ai_approval_requests (run_id, requested_by, action_kind, action_payload,
      status, expires_at, execution_status)
    values (r, u1, 'awx_job', '{"template":1}'::jsonb, 'pending', now() + interval '1 hour', 'in_flight');
    res := res || E'FAIL execution allowed without approval\n';
  exception when check_violation then res := res || E'PASS execution requires approval\n';
  end;

  insert into public.ai_approval_requests (run_id, requested_by, action_kind, action_payload,
    status, decided_by, decided_at, expires_at, payload_digest, idempotency_key)
  values (r, u1, 'awx_job', '{"template":1}'::jsonb, 'approved', u2, now(), now() + interval '1 hour',
    'sha256:aaa', 'run-'||r::text)
  returning id into a;

  -- 3. approved parameters are frozen
  begin
    update public.ai_approval_requests set action_payload = '{"template":99}'::jsonb where id = a;
    res := res || E'FAIL approved payload was mutable\n';
  exception when others then
    res := res || case when sqlerrm like '%immutable%' then E'PASS approved parameters immutable\n'
                       else E'FAIL unexpected: '||sqlerrm||E'\n' end;
  end;

  -- 4. a rejected approval cannot be revived
  update public.ai_approval_requests set status = 'rejected', decided_by = u2, decided_at = now()
    where id = a;
  begin
    update public.ai_approval_requests set status = 'approved' where id = a;
    res := res || E'FAIL rejected approval revived\n';
  exception when others then
    res := res || case when sqlerrm like '%revived%' then E'PASS rejected approval cannot be revived\n'
                       else E'FAIL unexpected: '||sqlerrm||E'\n' end;
  end;

  -- 5. one execution per idempotency key
  begin
    insert into public.ai_approval_requests (run_id, requested_by, action_kind, action_payload,
      status, expires_at, idempotency_key)
    values (r, u1, 'awx_job', '{"template":1}'::jsonb, 'pending', now() + interval '1 hour', 'run-'||r::text);
    res := res || E'FAIL duplicate idempotency key accepted\n';
  exception when unique_violation then res := res || E'PASS idempotency key is unique\n';
  end;

  -- 6. write switches are all disabled
  select not exists (select 1 from public.ai_write_switches where enabled) into ok;
  res := res || case when ok then E'PASS every write switch disabled\n' else E'FAIL a write switch is enabled\n' end;

  -- 7. one findings note per run
  insert into public.ai_run_workspaces (run_id, container_name, image_digest, volume_name)
  values (r, 'labops-inv-probe', 'sha256:probe', 'labops-ws-probe');
  begin
    insert into public.ai_run_workspaces (run_id, container_name, image_digest, volume_name)
    values (r, 'labops-inv-probe2', 'sha256:probe', 'labops-ws-probe2');
    res := res || E'FAIL two workspaces for one run\n';
  exception when unique_violation then res := res || E'PASS one workspace per run\n';
  end;

  raise exception 'CHECKS:%', E'\n' || res;
end $$;
