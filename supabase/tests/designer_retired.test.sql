-- RET-001 (decision D3): closing open human assignments hands the campaign
-- back to the automatic design path without losing any history.
begin;
select no_plan();
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.approve_calendar('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',1);
select public.save_copy('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',1,'{"subject":"Original considered note","preheader":"Synthetic","body":"Explore the details at your own pace.","cta":"Explore","url":"https://cedar-lane.example"}');
select public.approve_copy('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',2);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('test.assignment',public.assign_campaign('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',(select id from public.assignable_designers('00000000-0000-4000-8000-000000000101') limit 1),2)::text,true);
select throws_ok($$select private.retire_open_designer_assignments()$$,'42501',null,'a signed-in user cannot run the retirement');
reset role;
select is((select design_state from public.campaigns where id='00000000-0000-4000-8000-000000000601'),'assigned','an open human assignment holds the campaign');
select set_config('test.design_revision',(select design_revision from public.campaigns where id='00000000-0000-4000-8000-000000000601')::text,true);
select is(private.retire_open_designer_assignments(),1,'the one open assignment is closed');
select is((select state from public.designer_assignments where id=current_setting('test.assignment')::uuid),'cancelled','the assignment row is kept, cancelled');
select is((select design_state from public.campaigns where id='00000000-0000-4000-8000-000000000601'),'unassigned','the campaign is back to design not started');
select is((select design_revision from public.campaigns where id='00000000-0000-4000-8000-000000000601'),current_setting('test.design_revision')::integer+1,'the design version moves on, so an old upload cannot be approved');
select is((select delivery_state from public.campaigns where id='00000000-0000-4000-8000-000000000601'),'not_ready','no delivery is ready without a new design');
select is((select copy_state from public.campaigns where id='00000000-0000-4000-8000-000000000601'),'approved','the owner keeps the copy approval');
select is((select count(*) from public.designer_assignments where campaign_id='00000000-0000-4000-8000-000000000601' and state<>'cancelled'),0::bigint,'nothing blocks the automatic render path any more');
select is(private.retire_open_designer_assignments(),0,'running it again changes nothing');
select is((select count(*) from public.designer_assignments where id=current_setting('test.assignment')::uuid),1::bigint,'no assignment is deleted');
select * from finish();rollback;
