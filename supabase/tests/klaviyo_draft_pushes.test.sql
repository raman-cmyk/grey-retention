begin;
select plan(31);

-- PSH-001: the live push's steps. Workspace 101: owner ...01, staff ...05.
-- Workspace 102: owner ...04.
select ok(not has_function_privilege('anon','public.save_klaviyo_push(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.save_klaviyo_push(uuid,uuid,jsonb)','execute'),'browser roles cannot save a push step');
select ok(has_function_privilege('service_role','public.save_klaviyo_push(uuid,uuid,jsonb)','execute'),'the worker saves push steps');
select ok(not bool_or(has_table_privilege(r,'public.klaviyo_draft_pushes',p)),'nobody writes the push steps directly')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.klaviyo_draft_pushes','select'),'anonymous visitors cannot read them');
select ok(current_setting('server_version_num')::integer < 170000
  or not has_table_privilege('authenticated','public.klaviyo_draft_pushes','maintain'),'nor maintain them');

-- A planned run for workspace 101 and an email of it waiting for its push,
-- with its lease; one of workspace 102 too.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"}]}','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e102','00000000-0000-4000-8000-000000000102',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"}]}','00000000-0000-4000-8000-000000000004');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, lease_token, lease_until, created_by) values
  ('00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,
   '00000000-0000-4000-8000-00000000c101','push_queued','{}','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e102',0,
   '00000000-0000-4000-8000-00000000c102','push_queued','{}',null,null,'00000000-0000-4000-8000-000000000004');

create function pg_temp.save(step jsonb, t text default '00000000-0000-4000-8000-000000000101',
    k text default '00000000-0000-4000-8000-00000000c101') returns void language sql as $$
  select public.save_klaviyo_push(t::uuid, k::uuid, step)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;

-- Only a push whose build holds its lease saves its steps.
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000c102')$$,
  'PT409',null,'not without the build''s lease');
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000c101')$$,
  'PT409',null,'not another workspace''s push');
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c999')$$,
  'PT409',null,'not a push no build waits for');

-- Each step is checked before it is written.
select throws_ok(format('select pg_temp.save(%L)', x),'23514',null,'refused step: '||x)
  from unnest(array[
    '{}',
    '{"note":"x"}',
    '{"state":"sent"}',
    '{"images":{"https://cedar.example/a.jpg":"http://img.example/a.jpg"}}',
    '{"images":{"https://cedar.example/a.jpg":12}}',
    '{"templates":[{"approach":"C","id":"T1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deleted":false}]}',
    '{"templates":[{"approach":"A","id":"T1","hash":"short","deleted":false}]}',
    '{"templates":[{"approach":"A","id":"T 1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deleted":false,"variation":null}]}',
    '{"campaign_id":"Cmp 1","message_id":"Msg1"}',
    '{"designs":"B"}',
    '{"create_started_at":"yesterday"}',
    '{"checks":[{"id":"images","pass":"yes","problems":[]}]}',
    '{"written":"abc"}'
  ]) x;
select throws_ok($$select pg_temp.save('{"campaign_id":"Cmp1"}')$$,'23514',null,'a campaign is saved with its message');
select throws_ok($$select pg_temp.save('{"state":"drafted"}')$$,'23514',null,'drafted only with its campaign and designs');

-- Steps are saved one after another; pictures add up.
select lives_ok($$select pg_temp.save('{"images":{"https://cedar.example/a.jpg":"https://img.example/1.jpg"}}')$$,'a picture moved');
select lives_ok($$select pg_temp.save(jsonb_build_object('images',jsonb_build_object('https://cedar.example/b.jpg','https://img.example/2.jpg'),
  'create_started_at',now(),'campaign_id','Cmp1','message_id','Msg1',
  'templates',jsonb_build_array(jsonb_build_object('approach','A','id','T1','hash',repeat('a',64),'deleted',false,'variation','Var1')),
  'checks',jsonb_build_array(jsonb_build_object('id','images','pass',true,'problems','[]'::jsonb))))$$,'then the campaign');
select lives_ok($$select pg_temp.save(jsonb_build_object('state','drafted','designs','A','fallback','ab_test_refused','written',repeat('b',64)))$$,
  'then the draft is ready');
reset role;
select results_eq($$select state, (select count(*) from jsonb_object_keys(images))::integer, campaign_id, message_id, designs, fallback
    from public.klaviyo_draft_pushes where push_key='00000000-0000-4000-8000-00000000c101'$$,
  $$values ('drafted', 2, 'Cmp1', 'Msg1', 'A', 'ab_test_refused')$$,'with everything it made');

-- Members read their workspace's pushes; another workspace reads none.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.klaviyo_draft_pushes),1,'staff read their workspace''s push');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_draft_pushes),0,'another workspace reads none');
select throws_ok($$select public.save_klaviyo_push('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c101','{"state":"refused"}')$$,
  '42501',null,'a member cannot save a step');
reset role;

-- Once the lease has passed, nothing more is saved.
update public.email_builds set lease_until = now() - interval '1 second' where id='00000000-0000-4000-8000-00000000b101';
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.save('{"state":"refused","reason":"externally_modified"}')$$,'PT409',null,'an expired lease saves nothing');
reset role;

select * from finish();
rollback;
