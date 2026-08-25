-- Behavioural checks for the proposed LabOps migrations (run after both files).
\set ON_ERROR_STOP on

-- 1. Existing admins were granted super_admin by the roles migration -------
do $$
begin
  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = '11111111-1111-1111-1111-111111111111' and r.role_name = 'super_admin'
  ) then
    raise exception 'CHECK FAILED: existing admin did not receive super_admin';
  end if;
end $$;
\echo OK 1 existing admin backfilled to super_admin

-- 2. Staff predicate: staff true, student false, unknown user false ---------
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if not public.labops_is_staff() then raise exception 'CHECK FAILED: staff denied'; end if;
end $$;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if public.labops_is_staff() then raise exception 'CHECK FAILED: student treated as staff'; end if;
  if public.labops_can_approve() then raise exception 'CHECK FAILED: student can approve'; end if;
end $$;
set "request.jwt.claim.sub" = '';
do $$ begin
  if public.labops_is_staff() then raise exception 'CHECK FAILED: anonymous treated as staff'; end if;
end $$;
reset role;
reset "request.jwt.claim.sub";
\echo OK 2 staff predicates deny students and anonymous sessions

-- 3. Single active investigation -------------------------------------------
insert into public.ai_runs (id, support_request_id, requested_by, title, model, provider,
                            token_budget, wallclock_limit_seconds, status)
values ('55555555-5555-5555-5555-555555555555',
        '44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111',
        'Pod03 firewall', 'openai/gpt-5.5', 'openai', 250000, 1200, 'running');

do $$
begin
  begin
    insert into public.ai_runs (support_request_id, requested_by, title, model, provider,
                                token_budget, wallclock_limit_seconds, status)
    values ('44444444-4444-4444-4444-444444444444',
            '11111111-1111-1111-1111-111111111111',
            'Second run', 'openai/gpt-5.5', 'openai', 250000, 1200, 'queued');
    raise exception 'CHECK FAILED: a second active run was allowed';
  exception when unique_violation then null;
  end;
end $$;
\echo OK 3 second concurrent investigation rejected

-- 4. A terminal run frees the slot -----------------------------------------
update public.ai_runs set status = 'succeeded', ended_at = now()
where id = '55555555-5555-5555-5555-555555555555';
insert into public.ai_runs (id, support_request_id, requested_by, title, model, provider,
                            token_budget, wallclock_limit_seconds, status)
values ('66666666-6666-6666-6666-666666666666',
        '44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111',
        'Next run', 'openai/gpt-5.5', 'openai', 250000, 1200, 'queued');
\echo OK 4 terminal run releases the single-active slot

-- 5. updated_at trigger ----------------------------------------------------
do $$
declare before_ts timestamptz; after_ts timestamptz;
begin
  select updated_at into before_ts from public.ai_runs where id = '66666666-6666-6666-6666-666666666666';
  perform pg_sleep(0.01);
  update public.ai_runs set findings = 'test' where id = '66666666-6666-6666-6666-666666666666';
  select updated_at into after_ts from public.ai_runs where id = '66666666-6666-6666-6666-666666666666';
  if after_ts <= before_ts then raise exception 'CHECK FAILED: updated_at not touched'; end if;
end $$;
\echo OK 5 updated_at maintained on update

-- 6. No self-approval ------------------------------------------------------
do $$
begin
  begin
    insert into public.ai_approval_requests (run_id, requested_by, action_kind, status, decided_by, decided_at)
    values ('66666666-6666-6666-6666-666666666666',
            '11111111-1111-1111-1111-111111111111',
            'restart_guacamole', 'approved',
            '11111111-1111-1111-1111-111111111111', now());
    raise exception 'CHECK FAILED: self-approval was allowed';
  exception when check_violation then null;
  end;
end $$;
insert into public.ai_approval_requests (run_id, requested_by, action_kind, status, decided_by, decided_at)
values ('66666666-6666-6666-6666-666666666666',
        '11111111-1111-1111-1111-111111111111',
        'restart_guacamole', 'approved',
        '33333333-3333-3333-3333-333333333333', now());
\echo OK 6 self-approval rejected, distinct approver accepted

-- 7. Append-only audit tables ---------------------------------------------
insert into public.ai_run_events (run_id, seq, kind, payload)
values ('66666666-6666-6666-6666-666666666666', 1, 'agent_message', '{"text":"hello"}');
insert into public.ai_tool_actions (run_id, tool, outcome)
values ('66666666-6666-6666-6666-666666666666', 'awx.job_status', 'allowed');
insert into public.ai_model_usage (run_id, provider, model, prompt_tokens, completion_tokens, cost_usd)
values ('66666666-6666-6666-6666-666666666666', 'openai', 'openai/gpt-5.5', 1200, 300, 0.0450);

do $$
begin
  begin
    insert into public.ai_run_events (run_id, seq, kind) values
      ('66666666-6666-6666-6666-666666666666', 1, 'duplicate');
    raise exception 'CHECK FAILED: duplicate event seq allowed';
  exception when unique_violation then null;
  end;
end $$;
\echo OK 7 event/tool/usage rows insert, duplicate seq rejected

-- 8. Authenticated staff read, no write; student sees nothing --------------
grant select on public.ai_runs, public.ai_run_events, public.ai_messages,
  public.ai_artifacts, public.ai_tool_actions, public.ai_approval_requests,
  public.ai_knowledge_proposals, public.ai_model_usage, public.ai_integration_health
  to authenticated;

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
do $$
declare n integer;
begin
  select count(*) into n from public.ai_runs;
  if n = 0 then raise exception 'CHECK FAILED: staff cannot read runs'; end if;
  begin
    update public.ai_runs set findings = 'tampered';
    raise exception 'CHECK FAILED: authenticated staff could update a run';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_tool_actions (run_id, tool, outcome)
    values ('66666666-6666-6666-6666-666666666666', 'awx.launch', 'allowed');
    raise exception 'CHECK FAILED: authenticated staff could insert a tool action';
  exception when insufficient_privilege then null;
  end;
end $$;

set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
do $$
declare n integer;
begin
  select count(*) into n from public.ai_runs;
  if n <> 0 then raise exception 'CHECK FAILED: student can read runs'; end if;
  select count(*) into n from public.ai_model_usage;
  if n <> 0 then raise exception 'CHECK FAILED: student can read model usage'; end if;
end $$;
reset role;
\echo OK 8 staff read-only, student denied by RLS

-- 9. service_role cannot rewrite history ----------------------------------
grant select, insert on public.ai_run_events, public.ai_tool_actions, public.ai_model_usage to service_role;
set role service_role;
do $$
begin
  begin
    update public.ai_run_events set kind = 'rewritten';
    raise exception 'CHECK FAILED: service_role could update an event';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.ai_model_usage;
    raise exception 'CHECK FAILED: service_role could delete usage rows';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo OK 9 append-only enforced against the service role

-- 10. Ticket stays authoritative: a run cannot orphan its support request --
do $$
begin
  begin
    delete from public.support_requests where id = '44444444-4444-4444-4444-444444444444';
    raise exception 'CHECK FAILED: support request with runs was deletable';
  exception when foreign_key_violation then null;
  end;
end $$;
\echo OK 10 support_requests protected by on delete restrict
