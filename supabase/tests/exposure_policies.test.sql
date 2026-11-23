begin;
select plan(36);

-- SEG-EXP-a: the exposure policy (a proposal: its defaults were chosen for
-- this implementation; Raman has not supplied numbers). Owner ...01,
-- manager ...06 and staff ...05 are in workspace 101; owner ...04 runs
-- workspace 102.
create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.save(win integer, cap integer, priority text[], rev integer,
  t text default '00000000-0000-4000-8000-000000000101') returns integer language sql as $$
  select public.save_exposure_policy(t::uuid, win, cap, priority, rev)
$$;
create function pg_temp.changes(t text default '00000000-0000-4000-8000-000000000101') returns setof jsonb language sql as $$
  select detail from public.workspace_events where tenant_id = t::uuid and kind = 'exposure_policy_changed' order by created_at
$$;

-- Grants and the command's own settings.
select ok(has_function_privilege('authenticated','public.save_exposure_policy(uuid,integer,integer,text[],integer)','execute')
  and not has_function_privilege('anon','public.save_exposure_policy(uuid,integer,integer,text[],integer)','execute'),
  'signed-in people may call the command, anonymous visitors not');
select ok((select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'public.save_exposure_policy(uuid,integer,integer,text[],integer)'::regprocedure),
  'it runs as its owner with an empty search path');
select ok(not bool_or(has_table_privilege(r,'public.exposure_policies',p)),'nobody writes the table directly')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege('anon','public.exposure_policies','select'),'anonymous visitors cannot read it');

-- Only the owner saves it, for his own workspace.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
select throws_ok($$select pg_temp.save(7, 3, '{}', 0)$$,'42501',null,'staff cannot save it');
select pg_temp.as_user('00000000-0000-4000-8000-000000000006');
select throws_ok($$select pg_temp.save(7, 3, '{}', 0)$$,'42501',null,'a manager cannot either');
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.save(7, 3, '{}', 0)$$,'42501',null,'another workspace''s owner cannot');

-- Bad values are refused (23514), whatever the revision.
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select throws_ok(format('select pg_temp.save(%s, %s, %L, 0)', w, c, p),'23514',null,why)
  from (values
    ('0','3','{}','a window of no days'), ('31','3','{}','a window over 30 days'), ('null','3','{}','no window'),
    ('7','0','{}','a cap of no emails'), ('7','15','{}','a cap over 14'), ('7','null','{}','no cap'),
    ('7','3','{SEGa,SEGa}','a segment twice'), ('7','3','{"SEG a"}','an id with a space'),
    ('7','3','{SEGa,NULL}','an empty segment'), ('7','3',null,'no order at all')) as x(w, c, p, why);
select throws_ok($$select pg_temp.save(7, 3, (select array_agg('SEG'||g) from generate_series(1,51) g), 0)$$,
  '23514',null,'at most 50 segments');

-- The first save expects revision 0; each later one the revision read.
select throws_ok($$select pg_temp.save(7, 3, '{}', 1)$$,'PT409',null,'a first save with a revision is stale');
select is(pg_temp.save(7, 3, '{SEGeng030,LSTnews}', 0), 1, 'the owner saves the defaults');
select throws_ok($$select pg_temp.save(7, 4, '{}', 0)$$,'PT409',null,'a save from another window is refused');
select is(pg_temp.save(14, 4, '{LSTnews,SEGeng030}', 1), 2, 'the next save takes the revision read');
select is(pg_temp.save(14, 4, '{LSTnews,SEGeng030}', 2), 3, 'saving the same again is fine');
select is(pg_temp.save(1, 1, '{}', 3), 4, 'the smallest window and cap');
select is(pg_temp.save(30, 14, '{}', 4), 5, 'the largest window and cap');
reset role;
select is((select window_days||'/'||max_marketing||'/'||cardinality(priority)||'/'||revision
    ||'/'||(updated_by = '00000000-0000-4000-8000-000000000001') from public.exposure_policies
    where tenant_id = '00000000-0000-4000-8000-000000000101'),'30/14/0/5/true','as saved, with who saved it');

-- Who changed what, for Recent changes; a save that changed nothing is not a change.
select is((select count(*)::int from pg_temp.changes()),4,'every change is recorded once');
select is((select c from pg_temp.changes() c limit 1),
  '{"to_cap": 3, "from_cap": null, "to_window": 7, "from_window": null, "order_changed": false}'::jsonb,
  'the first save: what it was set to');
select is((select c from pg_temp.changes() c offset 1 limit 1),
  '{"to_cap": 4, "from_cap": 3, "to_window": 14, "from_window": 7, "order_changed": true}'::jsonb,
  'a change: before and after, and the order changed');
select is((select actor_id::text from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101'
    and kind = 'exposure_policy_changed' order by created_at limit 1),'00000000-0000-4000-8000-000000000001','by the owner');

-- Members read their own workspace's policy, never another's.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
select is((select max_marketing from public.exposure_policies),14,'staff read it');
select throws_ok($$update public.exposure_policies set max_marketing = 1$$,'42501',null,'and cannot change it directly');
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.exposure_policies),0,'another workspace reads none');
select is(pg_temp.save(7, 3, '{}', 0, '00000000-0000-4000-8000-000000000102'), 1,'its owner saves his own');
reset role;
select is((select max_marketing from public.exposure_policies where tenant_id = '00000000-0000-4000-8000-000000000101'),14,
  'and the first workspace''s policy is untouched');
set local role anon;
select throws_ok($$select count(*) from public.exposure_policies$$,'42501',null,'anonymous visitors cannot read it');
reset role;

select * from finish();
rollback;
