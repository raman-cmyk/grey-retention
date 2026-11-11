begin;
select plan(66);

-- PSH-001: the live push's steps. Workspace 101: owner ...01, staff ...05.
-- Workspace 102: owner ...04.
select ok(not has_function_privilege('anon','public.save_klaviyo_push(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.save_klaviyo_push(uuid,uuid,jsonb)','execute'),'browser roles cannot save a push step');
select ok(has_function_privilege('service_role','public.save_klaviyo_push(uuid,uuid,jsonb)','execute'),'the worker saves push steps');
select ok(not bool_or(has_table_privilege(r,'public.klaviyo_draft_pushes',p)),'nobody writes the push steps directly')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.klaviyo_draft_pushes','select'),'anonymous visitors cannot read them');
select ok(current_setting('server_version_num')::integer < 170000
  or not bool_or(has_table_privilege(r,'public.klaviyo_draft_pushes','maintain')),'nor maintain them')
  from unnest(array['anon','authenticated','service_role']) r;

-- A planned run for each workspace. Workspace 101: build b101 waits for
-- its push with lease aaaa; b103, an older failed build of the same email,
-- had the same key; b104 is another email still building. Workspace 102:
-- b102 waits for its push without a lease.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"},{"date":"2099-01-02","time":"10:00","emailType":"offer"}]}',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e102','00000000-0000-4000-8000-000000000102',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"}]}','00000000-0000-4000-8000-000000000004');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, lease_token, lease_until, created_by, created_at) values
  ('00000000-0000-4000-8000-00000000b103','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,
   '00000000-0000-4000-8000-00000000c101','failed','{}',null,null,'00000000-0000-4000-8000-000000000001',now()-interval '1 hour'),
  ('00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,
   '00000000-0000-4000-8000-00000000c101','push_queued','{}','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b104','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,
   '00000000-0000-4000-8000-00000000c104','build_queued',null,'00000000-0000-4000-8000-00000000bbbb',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e102',0,
   '00000000-0000-4000-8000-00000000c102','push_queued','{}',null,null,'00000000-0000-4000-8000-000000000004',now());

create function pg_temp.save(step jsonb, b text default '00000000-0000-4000-8000-00000000b101',
    l text default '00000000-0000-4000-8000-00000000aaaa') returns void language sql as $$
  select public.save_klaviyo_push(b::uuid, l::uuid, step)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;

-- Only the worker, even with the database role: the request's role is checked.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.save('{"state":"started"}')$$,'42501',null,'no request role, no save');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.save('{"state":"started"}')$$,'42501',null,'a member''s request cannot save');

-- Only the build's own push, under its exact, unexpired lease.
select pg_temp.as_worker();
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-00000000abcd')$$,
  'PT409',null,'not with another lease');
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-00000000b103','00000000-0000-4000-8000-00000000aaaa')$$,
  'PT409',null,'not as an older failed build of the same email');
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-00000000b104','00000000-0000-4000-8000-00000000bbbb')$$,
  'PT409',null,'not a build that is not in its push');
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-00000000aaaa')$$,
  'PT409',null,'not another workspace''s build');
select throws_ok($$select pg_temp.save('{"state":"started"}','00000000-0000-4000-8000-00000000b999')$$,
  'PT409',null,'not a build that does not exist');

-- Each step is checked before it is written.
select throws_ok(format('select pg_temp.save(%L)', x),'23514',null,'refused step: '||x)
  from unnest(array[
    '{}',
    '[]',
    '{"note":"x"}',
    '{"state":"sent"}',
    '{"state":1}',
    '{"images":[]}',
    '{"images":{"https://cedar.example/a.jpg":"http://img.example/a.jpg"}}',
    '{"images":{"https://cedar.example/a.jpg":12}}',
    '{"images":{"a.jpg":"https://img.example/a.jpg"}}',
    '{"templates":{}}',
    '{"templates":[{"approach":"C","id":"T1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deleted":false}]}',
    '{"templates":[{"approach":"A","id":"T1","hash":"short","deleted":false}]}',
    '{"templates":[{"approach":"A","id":"T 1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deleted":false}]}',
    '{"templates":[{"approach":"A","id":"T1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}',
    '{"templates":[{"approach":"A","id":"T1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deleted":false,"extra":1}]}',
    '{"templates":[{"approach":"A","id":"T1","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deleted":false,"variation":"V 1"}]}',
    '{"campaign_id":"Cmp 1","message_id":"Msg1"}',
    '{"campaign_id":12345,"message_id":"Msg1"}',
    '{"designs":"B"}',
    '{"fallback":true}',
    '{"fallback":"Bad Reason"}',
    '{"reason":"bad-reason"}',
    '{"create_started_at":"yesterday"}',
    '{"checks":[{"id":"images","pass":"yes","problems":[]}]}',
    '{"checks":[{"id":"Images","pass":true,"problems":[]}]}',
    '{"checks":[{"id":"images","pass":true,"problems":[],"extra":1}]}',
    '{"written":"abc"}'
  ]) x;
select throws_ok(format('select pg_temp.save(%L::jsonb)', jsonb_build_object('images',
  (select jsonb_object_agg('https://cedar.example/'||i||'.jpg','https://img.example/'||i||'.jpg') from generate_series(1,41) i))),
  '23514',null,'at most 40 pictures a step');
select throws_ok(format('select pg_temp.save(%L::jsonb)', jsonb_build_object('images',
  jsonb_build_object('https://cedar.example/a.jpg','https://img.example/'||repeat('a',2000)))),'23514',null,'a picture address of a sane length');
select throws_ok(format('select pg_temp.save(%L::jsonb)', jsonb_build_object('templates',
  (select jsonb_agg(jsonb_build_object('approach','A','id','T'||i,'hash',repeat('a',64),'deleted',true)) from generate_series(1,21) i))),
  '23514',null,'at most 20 templates');
select throws_ok(format('select pg_temp.save(%L::jsonb)', jsonb_build_object('checks',
  (select jsonb_agg(jsonb_build_object('id','c'||i,'pass',true,'problems','[]'::jsonb)) from generate_series(1,7) i))),
  '23514',null,'at most 6 checks');
select throws_ok(format('select pg_temp.save(%L::jsonb)', jsonb_build_object('checks',jsonb_build_array(jsonb_build_object('id','images','pass',false,
  'problems',(select jsonb_agg('A problem.'::text) from generate_series(1,11)))))),'23514',null,'at most 10 problems a check');
select throws_ok(format('select pg_temp.save(%L::jsonb)', jsonb_build_object('checks',jsonb_build_array(jsonb_build_object('id','images','pass',false,
  'problems',jsonb_build_array(repeat('x',301)))))),'23514',null,'a problem in a line');
select throws_ok($$select public.save_klaviyo_push('00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-00000000aaaa',null)$$,
  '23514',null,'a step is there');
select throws_ok($$select public.save_klaviyo_push(null,'00000000-0000-4000-8000-00000000aaaa','{"state":"started"}')$$,
  '23514',null,'a build is named');
select throws_ok($$select pg_temp.save('{"campaign_id":"Cmp1"}')$$,'23514',null,'a campaign is saved with its message');
select throws_ok($$select pg_temp.save('{"message_id":"Msg1"}')$$,'23514',null,'a message is saved with its campaign');
select throws_ok($$select pg_temp.save('{"state":"drafted"}')$$,'23514',null,'drafted only with its campaign and designs');
select throws_ok($$select pg_temp.save('{"state":"refused"}')$$,'23514',null,'refused only with its reason');

-- Steps are saved one after another; pictures add up.
select lives_ok($$select pg_temp.save('{"images":{"https://cedar.example/a.jpg":"https://img.example/1.jpg"}}')$$,'a picture moved');
select lives_ok($$select pg_temp.save(jsonb_build_object('images',jsonb_build_object('https://cedar.example/b.jpg','https://img.example/2.jpg'),
  'create_started_at',now(),'campaign_id','Cmp1','message_id','Msg1',
  'templates',jsonb_build_array(jsonb_build_object('approach','A','id','T1','hash',repeat('a',64),'deleted',false,'variation','Var1')),
  'checks',jsonb_build_array(jsonb_build_object('id','images','pass',true,'problems','[]'::jsonb))))$$,'then the campaign');
select lives_ok($$select pg_temp.save('{"campaign_id":"Cmp1","message_id":"Msg1"}')$$,'the same campaign again is fine');

-- What a push made stays made.
select throws_ok($$select pg_temp.save('{"campaign_id":"Cmp2","message_id":"Msg2"}')$$,'PT409',null,'its campaign is never swapped');
select throws_ok($$select pg_temp.save('{"campaign_id":null,"message_id":null}')$$,'PT409',null,'nor cleared');
select throws_ok($$select pg_temp.save('{"state":"started"}')$$,'PT409',null,'a push never starts again');
select lives_ok($$select pg_temp.save(jsonb_build_object('designs','A','fallback','ab_test_refused'))$$,'Klaviyo refused the even test: design A');
select throws_ok($$select pg_temp.save('{"designs":"both"}')$$,'PT409',null,'design A stays design A');
select lives_ok($$select pg_temp.save(jsonb_build_object('state','drafted','designs','A','written',repeat('b',64),'reason',null))$$,
  'then the draft is ready');
reset role;
select results_eq($$select state, (select count(*) from jsonb_object_keys(images))::integer, campaign_id, message_id, designs, fallback
    from public.klaviyo_draft_pushes where push_key='00000000-0000-4000-8000-00000000c101'$$,
  $$values ('drafted', 2, 'Cmp1', 'Msg1', 'A', 'ab_test_refused')$$,'with everything it made');
-- The owner deletes the draft in Klaviyo: the push is closed for good.
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.save('{"state":"refused","reason":"externally_modified"}')$$,'a draft changed in Klaviyo closes the push');
select throws_ok($$select pg_temp.save('{"state":"drafted","reason":null}')$$,'PT409',null,'and nothing is saved on it again');
reset role;

-- Members (and platform operators) read their workspace's pushes; another workspace reads none.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.klaviyo_draft_pushes),1,'staff read their workspace''s push');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_draft_pushes),0,'another workspace reads none');
reset role;

-- Once the lease has passed, nothing more is saved.
update public.email_builds set lease_until = now() - interval '1 second' where id='00000000-0000-4000-8000-00000000b101';
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.save('{"checks":[]}')$$,'PT409',null,'an expired lease saves nothing');
reset role;

select * from finish();
rollback;
