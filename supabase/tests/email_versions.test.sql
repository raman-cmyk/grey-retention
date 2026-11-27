begin;
select plan(89);

-- PICK-106: every email GROS makes for a planned email is kept as a
-- version, and the owner brings an older one back. Workspace 101: owner
-- ...01, staff ...05, manager (admin) ...06. Workspace 102: owner ...04.

create function pg_temp.as_member(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true) $$;
create function pg_temp.as_job() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
grant execute on function pg_temp.as_job() to service_role;
grant execute on function pg_temp.as_member(text) to authenticated;
-- The error code and hint a statement raises (or 'ok').
create function pg_temp.refusal(q text) returns text language plpgsql as $$
declare c text; h text;
begin
  execute q;
  return 'ok';
exception when others then
  get stacked diagnostics c = returned_sqlstate, h = pg_exception_hint;
  return c || ':' || coalesce(h, '');
end $$;
grant execute on function pg_temp.refusal(text) to authenticated, service_role;
create function pg_temp.versions(run uuid, s integer) returns text language sql as $$
  select coalesce(string_agg(number || ':' || how || coalesce('<' || restored_from, ''), ',' order by number), '')
  from public.email_versions where run_id = run and slot = s $$;
create function pg_temp.lease(b uuid, l uuid) returns void language sql as $$
  update public.email_builds set lease_token = l, lease_until = now() + interval '5 minutes' where id = b $$;

-- 1. The table: row security on, written by the commands only.
select ok((select relrowsecurity from pg_class where oid = 'public.email_versions'::regclass), 'row security is on');
select ok(not bool_or(has_table_privilege(r, 'public.email_versions', p)), 'nobody writes versions directly')
  from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p;
select ok(not has_table_privilege('anon', 'public.email_versions', 'select'), 'anon reads nothing');
select ok(not has_function_privilege(r, 'public.restore_email_version(uuid,uuid,integer,integer)', 'execute'),
  r || ' cannot restore') from unnest(array['anon', 'service_role']) r;
select ok(has_function_privilege('authenticated', 'public.restore_email_version(uuid,uuid,integer,integer)', 'execute'),
  'members call restore (the owner check is inside)');
select ok(not has_function_privilege('authenticated', 'public.finish_email_build(uuid,uuid,jsonb)', 'execute'),
  'members cannot finish a build');
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'only the commands add versions: ' || f::text)
  from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['private.add_email_version(public.email_builds,text,jsonb,integer,uuid)'::regprocedure,
      'private.email_build_how(public.email_builds)'::regprocedure]) f
  group by f;
select ok(pg_get_functiondef('public.finish_email_build(uuid,uuid,jsonb)'::regprocedure)
    ~ 'from public\.tenants where id = t for share.*leased_email_build.*add_email_version',
  'the finish takes the workspace, then the build, then writes the version');
select ok(pg_get_functiondef('public.restore_email_version(uuid,uuid,integer,integer)'::regprocedure)
    ~ 'require_member\(t, true\).*for update',
  'the restore takes the workspace (owner only) before the build');

-- A plan of workspace 101 with four emails, one of workspace 102.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e106', '00000000-0000-4000-8000-000000000101', current_date, 'planned',
   '{"offers":[]}', '{"mode":"auto"}', jsonb_build_object('slots', jsonb_build_array(
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '10:00'),
     jsonb_build_object('date', to_char(current_date + 4, 'YYYY-MM-DD'), 'time', '10:00'),
     jsonb_build_object('date', to_char(current_date - 1, 'YYYY-MM-DD'), 'time', '10:00'),
     jsonb_build_object('date', to_char(current_date + 5, 'YYYY-MM-DD'), 'time', '10:00'))),
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e206', '00000000-0000-4000-8000-000000000102', current_date, 'planned',
   '{"offers":[]}', '{"mode":"auto"}', jsonb_build_object('slots', jsonb_build_array(
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '10:00'))),
   '00000000-0000-4000-8000-000000000004');

-- 2. A new build of slot 0 finishes: version 1, in the same transaction.
-- Its first try failed at the push (an email was built): that is version 1
-- of the planned email, and the build made after it is "Try again".
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, created_by) values
  ('00000000-0000-4000-8000-00000000b161', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 0,
   '00000000-0000-4000-8000-00000000c161', 'build_queued', 'design', '00000000-0000-4000-8000-000000000001');
select pg_temp.lease('00000000-0000-4000-8000-00000000b161', '00000000-0000-4000-8000-00000000a161');
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_email_build('00000000-0000-4000-8000-00000000b161', '00000000-0000-4000-8000-00000000a161',
  '{"subject":"First try","preheader":"p","html":"<p>one</p>"}')$$, 'the design step finishes the email');
select throws_ok($$select public.finish_email_build('00000000-0000-4000-8000-00000000b161', '00000000-0000-4000-8000-00000000a161',
  '{"subject":"First try","preheader":"p","html":"<p>one</p>"}')$$, 'PT409', 'Lease unavailable', 'a retried finish is refused');
reset role;
select is(pg_temp.versions('00000000-0000-4000-8000-00000000e106', 0), '1:scratch', 'one version, made from scratch');
select is((select subject || '|' || (email->>'html') from public.email_versions where build_id = '00000000-0000-4000-8000-00000000b161'),
  'First try|<p>one</p>', 'it keeps the subject and the stored email');
-- The same build output again (a retry that got this far) adds nothing.
select is(private.add_email_version(b, 'scratch', b.email), null, 'one version per build output')
  from public.email_builds b where b.id = '00000000-0000-4000-8000-00000000b161';
select is(pg_temp.versions('00000000-0000-4000-8000-00000000e106', 0), '1:scratch', 'still one version');
-- Its push failed for good.
update public.email_builds set state = 'failed', error_code = 'klaviyo_unavailable'
  where id = '00000000-0000-4000-8000-00000000b161';

-- 3. Try again: a new build of the same planned email, the same push key.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000e106', 0)$$, 'the owner tries again');
reset role;
update public.email_builds set step = 'design' where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0
  and state = 'build_queued';
select pg_temp.lease(id, '00000000-0000-4000-8000-00000000a162') from public.email_builds
  where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0 and state = 'build_queued';
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_email_build(b.id, '00000000-0000-4000-8000-00000000a162',
  '{"subject":"Second try","preheader":"p","html":"<p>two</p>"}') from public.email_builds b
  where b.run_id = '00000000-0000-4000-8000-00000000e106' and b.slot = 0 and b.state = 'build_queued'$$, 'it is made again');
reset role;
select is(pg_temp.versions('00000000-0000-4000-8000-00000000e106', 0), '1:scratch,2:try_again', 'version 2, made again with Try again');
-- It is in Klaviyo as a draft.
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'CmpV01', sample_draft = false
  where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0 and state = 'push_queued';

-- 4. How a first build was made: the owner's choice.
insert into public.email_builds (id, tenant_id, run_id, slot, state, step, mode, upload_id, created_by) values
  ('00000000-0000-4000-8000-00000000b163', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 1,
   'failed', 'design', 'copy', '00000000-0000-4000-8000-00000000d163', '00000000-0000-4000-8000-000000000001');
select is(private.email_build_how(b), 'upload_copy', 'a copy of the owner''s own email')
  from public.email_builds b where b.id = '00000000-0000-4000-8000-00000000b163';
delete from public.email_builds where id = '00000000-0000-4000-8000-00000000b163';
insert into public.email_builds (id, tenant_id, run_id, slot, state, step, mode, reference_id, created_by) values
  ('00000000-0000-4000-8000-00000000b164', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 1,
   'build_queued', 'design', 'remix', '00000000-0000-4000-8000-00000000d164', '00000000-0000-4000-8000-000000000001');
select is(private.email_build_how(b), 'remix', 'a remix')
  from public.email_builds b where b.id = '00000000-0000-4000-8000-00000000b164';
update public.email_builds set mode = 'copy' where id = '00000000-0000-4000-8000-00000000b164';
select is(private.email_build_how(b), 'library_copy', 'a copy of an Inspiration email')
  from public.email_builds b where b.id = '00000000-0000-4000-8000-00000000b164';
-- Slot 1 stays being made (for the busy refusal below).

-- Workspace 102's own draft and version.
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, created_by) values
  ('00000000-0000-4000-8000-00000000b261', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-00000000e206', 0,
   '00000000-0000-4000-8000-00000000c261', 'build_queued', 'design', '00000000-0000-4000-8000-000000000004');
select pg_temp.lease('00000000-0000-4000-8000-00000000b261', '00000000-0000-4000-8000-00000000a261');
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_email_build('00000000-0000-4000-8000-00000000b261', '00000000-0000-4000-8000-00000000a261',
  '{"subject":"Theirs","preheader":"p","html":"<p>x</p>"}')$$, 'another workspace''s email');
select is((select count(*)::integer from public.email_versions), 3, 'the job reads every version (its own work)');
reset role;

-- 5. Who reads them.
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.email_versions), 2, 'staff read their workspace''s versions');
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select string_agg(subject, ',') from public.email_versions), 'Theirs', 'another workspace reads only its own');
reset role;

-- 6. Who restores: the owner of the email's own workspace only.
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from public.email_builds where state = 'drafted' limit 1), 1, 2)$$), '42501:', 'not in another workspace');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-00000000b161', 1, 2)$$), '42501:version_no_email', 'nor another workspace''s email from his own');
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from public.email_builds where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0 and state = 'drafted'),
  1, 2)$$), '42501:', 'staff cannot');
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000006');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from public.email_builds where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0 and state = 'drafted'),
  1, 2)$$), '42501:', 'a manager cannot');
reset role;

-- 7. The owner's refusals, each with its hint.
create temp table cur as select id from public.email_builds
  where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0 and state = 'drafted';
grant select on cur to authenticated, service_role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 1, 1)$$), 'PT409:version_stale', 'a page that showed an older newest version is stale');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 2, 2)$$), '22023:version_current', 'the current version is not brought back');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 7, 2)$$), '22023:version_unknown', 'nor one that is not kept');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000b164', 1, 1)$$), 'PT409:version_busy', 'an email being made is refused');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000b161', 1, 2)$$), 'PT409:version_not_drafted', 'a failed build is not a draft');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), null, 2)$$), '22023:version_unknown', 'no version chosen');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 1, null)$$), '22023:version_unknown', 'no newest version shown');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-0000000000ff', 1, 2)$$), '42501:version_no_email', 'an email that is not there');
reset role;
-- A paused workspace's emails are not changed (its jobs do not run).
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000101';
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 1, 2)$$), '42501:', 'a paused workspace is refused (its owner is no active member)');
reset role;
update public.tenants set status = 'active' where id = '00000000-0000-4000-8000-000000000101';

-- What the owner did in Klaviyo (PICK-99's sync), on any build of its push key.
insert into public.klaviyo_email_results (tenant_id, build_id, run_id, slot, sample, campaign_id, message_id, planned, status,
    scheduled_for) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000b161', '00000000-0000-4000-8000-00000000e106', 0,
   false, 'CmpV01', 'MsgV01', '{"date":"2026-12-01","subject":"Second try","code":"OLD10"}', 'scheduled', now() + interval '2 days');
create function pg_temp.seen_as(status text, edits text default '') returns text language plpgsql as $$
begin
  update public.klaviyo_email_results set status = seen_as.status,
    scheduled_for = case when seen_as.status in ('scheduled', 'sending') then now() + interval '2 days' end,
    sent_at = case when seen_as.status = 'sent' then now() end,
    changed = edits = 'words', design_changed = edits = 'design',
    design_evidence = case when edits = 'design' then jsonb_build_object('variation', 'VarA01',
      'recorded', repeat('a', 16), 'current', repeat('b', 16), 'firstSeenAt', '2026-11-20T10:00:00Z',
      'lastSeenAt', '2026-11-20T10:00:00Z', 'checks', 1) end
    where build_id = '00000000-0000-4000-8000-00000000b161';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001',
    'role', 'authenticated')::text, true);
  return pg_temp.refusal($q$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
    (select id from cur), 1, 2)$q$);
end $$;
select is(pg_temp.seen_as('scheduled'), 'PT409:version_scheduled', 'a draft scheduled in Klaviyo is refused');
select is(pg_temp.seen_as('sending'), 'PT409:version_sent', 'one Klaviyo is sending is refused');
select is(pg_temp.seen_as('sent'), 'PT409:version_sent', 'one sent from Klaviyo is refused');
select is(pg_temp.seen_as('deleted'), 'PT409:version_gone', 'one deleted in Klaviyo is refused');
select is(pg_temp.seen_as('cancelled'), 'PT409:version_gone', 'one cancelled in Klaviyo is refused');
select is(pg_temp.seen_as('draft', 'words'), 'PT409:version_edited', 'one whose words the owner changed is left alone');
select is(pg_temp.seen_as('draft', 'design'), 'PT409:version_edited', 'one whose design the owner changed is left alone');
update public.klaviyo_email_results set status = 'draft', scheduled_for = null, sent_at = null, changed = false,
  design_changed = false, design_evidence = null where build_id = '00000000-0000-4000-8000-00000000b161';
select is((select count(*)::integer from public.email_versions where how = 'restore'), 0, 'no refusal added a version');
select is((select state from public.email_builds where id = (select id from cur)), 'drafted', 'nor changed the draft');

-- 8. "Use this version": version 1 comes back as version 3, pending.
create temp table lease (token uuid);
grant select, insert, delete on lease to service_role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.restore_email_version('00000000-0000-4000-8000-000000000101', (select id from cur), 1, 2), 3,
  'the owner brings version 1 back');
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 1, 3)$$), 'PT409:version_busy', 'a second click is refused, not a second version');
reset role;
select is(pg_temp.versions('00000000-0000-4000-8000-00000000e106', 0), '1:scratch,2:try_again,3:restore<1',
  'history is kept: the restore is a new version');
select is((select email->>'html' from public.email_versions where run_id = '00000000-0000-4000-8000-00000000e106' and number = 2),
  '<p>two</p>', 'version 2 is unchanged');
select is((select created_by::text || '|' || outcome from public.email_versions where how = 'restore'),
  '00000000-0000-4000-8000-000000000001|pending', 'the restore names the owner and waits for its push');
select is(private.current_email_version('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 0), 2,
  'until it reaches the draft, version 2 is current');
select is((select state || '|' || step || '|' || coalesce(klaviyo_campaign_id, '-') || '|' || (email->>'html') || '|' || push_key
    || '|' || restore_campaign_id || '|' || (restore_email->>'html')
  from public.email_builds where id = (select id from cur)),
  'push_queued|push|-|<p>one</p>|00000000-0000-4000-8000-00000000c161|CmpV01|<p>two</p>',
  'the old email goes to the push with the planned email''s push key; the draft''s own email and campaign wait beside it');
-- The push job claims it as any push, and Klaviyo takes it: the same draft.
select pg_temp.as_job();
set local role service_role;
insert into lease select c.lease_token from public.claim_email_build((select id from cur)) c;
select lives_ok($$select public.finish_email_push((select id from cur), (select token from lease), 'CmpV01', false)$$,
  'the push updates the same draft');
reset role;
select is((select state || '|' || klaviyo_campaign_id || '|' || (email->>'html') || '|' || coalesce(restore_campaign_id, '-')
  from public.email_builds where id = (select id from cur)), 'drafted|CmpV01|<p>one</p>|-', 'the draft holds version 1 again');
select is((select outcome from public.email_versions where run_id = '00000000-0000-4000-8000-00000000e106' and number = 3),
  'applied', 'the restore is applied');
select is(private.current_email_version('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 0), 3,
  'and current');
select is((select (planned->>'subject') || '|' || coalesce(planned->>'code', '-') || '|' || (planned->>'date')
  from public.klaviyo_email_results where build_id = '00000000-0000-4000-8000-00000000b161'), 'First try|-|2026-12-01',
  'the results row now describes the version sent (no code any more), its other facts kept');
-- Version 1 again (the draft holds it word for word): nothing to do.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 1, 3)$$), '22023:version_current', 'a version the draft already holds is not pushed again');
reset role;

-- 9. A push that does not get there never breaks the draft.
-- Klaviyo says it is no longer a draft (scheduled there since the last check).
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.restore_email_version('00000000-0000-4000-8000-000000000101', (select id from cur), 2, 3), 4,
  'the owner brings version 2 back');
reset role;
delete from lease;
select pg_temp.as_job();
set local role service_role;
insert into lease select c.lease_token from public.claim_email_build((select id from cur)) c;
select is(public.fail_email_step((select id from cur), (select token from lease), 'klaviyo_refused_not_a_draft', true), 'failed',
  'the pusher refuses it');
reset role;
select is((select state || '|' || klaviyo_campaign_id || '|' || (email->>'html') || '|' || coalesce(error_code, '-')
    || '|' || attempts || '|' || coalesce(restore_campaign_id, '-')
  from public.email_builds where id = (select id from cur)), 'drafted|CmpV01|<p>one</p>|-|0|-',
  'the build is its draft again, with its email and campaign');
select is((select outcome || '|' || failure from public.email_versions where run_id = '00000000-0000-4000-8000-00000000e106'
  and slot = 0 and number = 4), 'failed|klaviyo_refused_not_a_draft', 'the restore is marked not used, with why');
select is(private.current_email_version('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 0), 3,
  'version 3 stays current');
select is((select count(*)::integer from public.email_builds where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 0
  and state = 'failed'), 1, 'no failed try is counted (only the first build''s)');
-- Klaviyo down: after 3 tries the push gives up, and the draft is kept.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.restore_email_version('00000000-0000-4000-8000-000000000101', (select id from cur), 2, 4), 5,
  'a restore that did not get there can be tried again');
reset role;
select pg_temp.as_job();
set local role service_role;
delete from lease;
insert into lease select c.lease_token from public.claim_email_build((select id from cur)) c;
select is(public.fail_email_step((select id from cur), (select token from lease), 'klaviyo_unavailable'), 'retry',
  'the first outage is tried again');
reset role;
select is((select state from public.email_builds where id = (select id from cur)), 'push_queued', 'still waiting for its push');
update public.email_builds set attempts = 3 where id = (select id from cur);
select pg_temp.lease((select id from cur), '00000000-0000-4000-8000-00000000a163');
select pg_temp.as_job();
set local role service_role;
select is(public.fail_email_step((select id from cur), '00000000-0000-4000-8000-00000000a163', 'klaviyo_unavailable'), 'failed',
  'the third outage gives up');
reset role;
select is((select state || '|' || klaviyo_campaign_id || '|' || (email->>'html') from public.email_builds
  where id = (select id from cur)), 'drafted|CmpV01|<p>one</p>', 'the draft is kept as it was');
select is((select outcome || '|' || failure from public.email_versions where run_id = '00000000-0000-4000-8000-00000000e106'
  and slot = 0 and number = 5), 'failed|klaviyo_unavailable', 'and the restore is not used');
-- A claim that gives the push up (its day passed, its lease ran out) keeps the draft too.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.restore_email_version('00000000-0000-4000-8000-000000000101', (select id from cur), 2, 5), 6,
  'tried again');
reset role;
update public.email_builds set attempts = 3, updated_at = now() - interval '2 minutes' where id = (select id from cur);
select pg_temp.as_job();
set local role service_role;
select is((select count(*)::integer from public.claim_email_build((select id from cur))), 0, 'the claim gives it up');
reset role;
select is((select state || '|' || klaviyo_campaign_id from public.email_builds where id = (select id from cur)), 'drafted|CmpV01',
  'and the draft is kept');
select is((select outcome || '|' || failure from public.email_versions where run_id = '00000000-0000-4000-8000-00000000e106'
  and slot = 0 and number = 6), 'failed|step_timed_out', 'the restore says why');

-- 10. A day that has passed is refused.
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, email, klaviyo_campaign_id, created_by) values
  ('00000000-0000-4000-8000-00000000b165', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 2,
   '00000000-0000-4000-8000-00000000c165', 'drafted', 'push', '{"subject":"Old","preheader":"p","html":"<p>o</p>"}', 'CmpV02',
   '00000000-0000-4000-8000-000000000001');
select private.add_email_version(b, 'scratch', '{"subject":"Older","preheader":"p","html":"<p>older</p>"}')
  from public.email_builds b where b.id = '00000000-0000-4000-8000-00000000b165';
select private.add_email_version(b, 'restore', b.email, 1, '00000000-0000-4000-8000-000000000001')
  from public.email_builds b where b.id = '00000000-0000-4000-8000-00000000b165';
update public.email_versions set outcome = 'applied' where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 2 and number = 2;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000b165', 1, 2)$$), 'PT409:version_day_passed', 'an email whose day passed is not changed');
reset role;

-- 11. At most 20 per planned email, through restores: the oldest go, the
-- current one stays, the numbers go on.
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, email, created_by) values
  ('00000000-0000-4000-8000-00000000b167', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 3,
   '00000000-0000-4000-8000-00000000c166', 'failed', 'push', '{"subject":"A","preheader":"p","html":"<p>a</p>"}',
   '00000000-0000-4000-8000-000000000001');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, email, klaviyo_campaign_id, created_by,
    created_at) values
  ('00000000-0000-4000-8000-00000000b166', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 3,
   '00000000-0000-4000-8000-00000000c166', 'drafted', 'push', '{"subject":"B","preheader":"p","html":"<p>b</p>"}', 'CmpV03',
   '00000000-0000-4000-8000-000000000001', now() + interval '1 second');
select private.add_email_version(b, private.email_build_how(b), b.email)
  from public.email_builds b where b.id in ('00000000-0000-4000-8000-00000000b167', '00000000-0000-4000-8000-00000000b166')
  order by b.created_at;
do $$
declare n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001',
    'role', 'authenticated')::text, true);
  for i in 1..22 loop
    select max(number) into n from public.email_versions where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 3;
    perform public.restore_email_version('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000b166',
      case when n = 2 then 1 else n end, n);
    -- Its push does not get there: the draft is back, the restore not used.
    update public.email_builds set state = 'failed', error_code = 'klaviyo_unavailable'
      where id = '00000000-0000-4000-8000-00000000b166';
  end loop;
end $$;
select is((select count(*)::integer || ':' || min(number) || '-' || max(number) from public.email_versions
  where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 3), '20:2-24', 'the current one and the 19 newest are kept');
select is((select string_agg(number::text, ',' order by number) from public.email_versions
  where run_id = '00000000-0000-4000-8000-00000000e106' and slot = 3 and number < 7), '2,6', 'the oldest others went');
select is(pg_temp.versions('00000000-0000-4000-8000-00000000e106', 0), '1:scratch,2:try_again,3:restore<1,4:restore<2,5:restore<2,6:restore<2',
  'another email''s versions are untouched');

-- 12. Who else reads and finishes.
select pg_temp.as_member('00000000-0000-4000-8000-000000000002');
set local role authenticated;
select ok((select count(*)::integer from public.email_versions) > 20, 'a platform operator reads them');
reset role;
select set_config('request.jwt.claims', '{}', true);
select is(pg_temp.refusal($$select public.finish_email_build('00000000-0000-4000-8000-00000000b166',
  '00000000-0000-4000-8000-00000000a161', '{}')$$), '42501:', 'no role finishes a build');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(left(pg_temp.refusal($$select public.finish_email_build('00000000-0000-4000-8000-00000000b166',
  '00000000-0000-4000-8000-00000000a161', '{}')$$), 6), '42501:', 'nor a member');
reset role;

-- 13. Only the latest plan, still planned.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by, created_at) values
  ('00000000-0000-4000-8000-00000000e107', '00000000-0000-4000-8000-000000000101', current_date + 1, 'plan_queued',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000001', now() + interval '1 minute');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 2, 6)$$), 'PT409:version_plan_replaced', 'a plan replaced by a newer one is refused');
reset role;
delete from public.strategy_runs where id = '00000000-0000-4000-8000-00000000e107';
update public.strategy_runs set state = 'failed', plan = null where id = '00000000-0000-4000-8000-00000000e106';
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.refusal($$select public.restore_email_version('00000000-0000-4000-8000-000000000101',
  (select id from cur), 2, 6)$$), 'PT409:version_plan_replaced', 'a plan that is not planned is refused');
reset role;

-- 14. Versions belong to their email: a version of another planned email
-- or workspace cannot be pointed at this build.
select throws_ok($$insert into public.email_versions (tenant_id, run_id, slot, number, build_id, how, subject, email) values
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-00000000e206', 0, 9,
   '00000000-0000-4000-8000-00000000b164', 'scratch', 's', '{}')$$, '23503', null,
  'a version never points at another workspace''s build');
select throws_ok($$insert into public.email_versions (tenant_id, run_id, slot, number, build_id, how, subject, email) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e106', 2, 99,
   '00000000-0000-4000-8000-00000000b165', 'restore', 's', '{}')$$, '23514', null,
  'a restore names the version it brought back, the owner and its outcome');

select * from finish();
rollback;
