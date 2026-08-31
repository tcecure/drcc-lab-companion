-- Assertions for PROPOSED_20260901000000_labops_ai_direct_chat.sql.
\set ON_ERROR_STOP on

do $$
declare requester uuid; request_id uuid; direct_id uuid;
begin
  select id into requester from auth.users order by id limit 1;
  select support_request_id into request_id from public.ai_runs
    where support_request_id is not null limit 1;

  -- 1. every run that already existed is a ticket investigation
  if exists (select 1 from public.ai_runs where source <> 'support_request') then
    raise exception 'an existing run was backfilled as something other than a ticket';
  end if;

  -- 2. a direct run needs no ticket
  insert into public.ai_runs (source, support_request_id, requested_by, title, model, provider, token_budget, wallclock_limit_seconds, status)
  values ('direct', null, requester, 'Why did the verifier fail?', 'openai/gpt-5.5', 'openai', 120000, 1200, 'succeeded')
  returning id into direct_id;

  -- 3. a ticket investigation still has to name its ticket
  begin
    insert into public.ai_runs (source, support_request_id, requested_by, title, model, provider, token_budget, wallclock_limit_seconds, status)
    values ('support_request', null, requester, 'no ticket', 'openai/gpt-5.5', 'openai', 120000, 1200, 'succeeded');
    raise exception 'a ticket investigation was accepted without a ticket';
  exception when check_violation then null; end;

  -- 4. a direct run must not be attached to a ticket
  begin
    insert into public.ai_runs (source, support_request_id, requested_by, title, model, provider, token_budget, wallclock_limit_seconds, status)
    values ('direct', request_id, requester, 'both', 'openai/gpt-5.5', 'openai', 120000, 1200, 'succeeded');
    raise exception 'a direct run was allowed to claim a ticket';
  exception when check_violation then null; end;

  -- 5. only the two known sources exist
  begin
    insert into public.ai_runs (source, support_request_id, requested_by, title, model, provider, token_budget, wallclock_limit_seconds, status)
    values ('mailbox', null, requester, 'unknown source', 'openai/gpt-5.5', 'openai', 120000, 1200, 'succeeded');
    raise exception 'an unknown run source was accepted';
  exception when check_violation then null; end;

  -- 6. the transcript hangs off the run, not the ticket
  insert into public.ai_messages (run_id, role, content)
  values (direct_id, 'user', 'Why did the verifier fail?'),
         (direct_id, 'assistant', 'The seed job never ran.');

  if (select count(*) from public.ai_messages where run_id = direct_id) <> 2 then
    raise exception 'the direct transcript did not persist';
  end if;

  -- 7. deleting the run takes its transcript with it
  delete from public.ai_runs where id = direct_id;

  if exists (select 1 from public.ai_messages where run_id = direct_id) then
    raise exception 'a deleted direct run left its transcript behind';
  end if;
end $$;

-- 8. history is indexed the way the sidebar reads it
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'ai_runs'
      and indexdef ilike '%(source, created_at DESC)%'
  ) then
    raise exception 'the direct history index is missing';
  end if;
end $$;

-- 9. clients still cannot read or write runs directly
do $$
begin
  if has_table_privilege('authenticated', 'public.ai_runs', 'INSERT')
     or has_table_privilege('anon', 'public.ai_runs', 'SELECT') then
    raise exception 'client grants appeared on ai_runs';
  end if;
end $$;

select 'direct chat checks passed' as result;
