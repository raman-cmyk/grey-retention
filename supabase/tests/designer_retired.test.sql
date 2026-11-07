-- RET-001 (decision D3): retiring the human designer hands every campaign to
-- the automatic design path without losing history, and nobody can bring
-- the human path back.
begin;
select no_plan();

-- Owner approves the calendar and copy of the demo campaign (601).
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.approve_calendar('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',1);
select public.save_copy('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',1,'{"subject":"Original considered note","preheader":"Synthetic","body":"Explore the details at your own pace.","cta":"Explore","url":"https://cedar-lane.example"}');
select public.approve_copy('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',2);

-- Signed-in users can no longer assign a designer.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.assign_campaign('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000201',2)$$,'42501',null,'a platform admin can no longer assign a designer');
select throws_ok($$select private.retire_open_designer_assignments()$$,'42501',null,'a signed-in user cannot run the retirement');
reset role;

-- Fixtures, written directly because the human path is closed:
-- 601 has a submitted human design (open), 602 in the other workspace has a
-- redo requested (open), 603 has an approved human design (history) and 604
-- was sent back to "not started" after one (history that used to block).
insert into public.campaigns(id,tenant_id,title,goal,channel,planned_at,timezone,audience_id,product_id,offer_id,created_by,synthetic,lineage)
select ('00000000-0000-4000-8000-00000000060'||n)::uuid,tenant_id,title||' '||n,goal,channel,planned_at,timezone,audience_id,product_id,offer_id,created_by,synthetic,lineage
from public.campaigns, unnest(array['3','4']) n where id='00000000-0000-4000-8000-000000000601';
update public.campaigns set calendar_state='approved',copy_state='approved' where id in ('00000000-0000-4000-8000-000000000603','00000000-0000-4000-8000-000000000604');
update public.campaigns set design_state='submitted' where id='00000000-0000-4000-8000-000000000601';
update public.campaigns set design_state='revisions_requested' where id='00000000-0000-4000-8000-000000000602';
update public.campaigns set design_state='owner_approved' where id='00000000-0000-4000-8000-000000000603';
insert into public.designer_assignments(tenant_id,campaign_id,designer_id,copy_revision,brief,due_at,assigned_by,state)
select tenant_id,id,'00000000-0000-4000-8000-000000000201',copy_revision,'{}',now()+interval '1 day','00000000-0000-4000-8000-000000000002',s
from public.campaigns join (values('00000000-0000-4000-8000-000000000601'::uuid,'submitted'),('00000000-0000-4000-8000-000000000602'::uuid,'revisions_requested'),('00000000-0000-4000-8000-000000000603'::uuid,'approved'),('00000000-0000-4000-8000-000000000604'::uuid,'approved')) v(cid,s) on v.cid=id;
insert into public.notifications(tenant_id,recipient_id,kind,entity_id,message)
values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','design_review','00000000-0000-4000-8000-000000000601','A new design version is ready for owner review.');
create temp table before_retire on commit drop as select id,design_state,design_revision,delivery_revision from public.campaigns;
create temp table render_attempt(campaign uuid,msg text) on commit drop;

-- The render path, as the owner: an open assignment still blocks, a stale
-- version is a business conflict (PT409), an old approved assignment no
-- longer blocks.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.enqueue_render('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',2,(select design_revision from public.campaigns where id='00000000-0000-4000-8000-000000000601'))$$,'23514','Human assignment active; admin must cancel it before changing paths','an open human assignment still blocks the render path');
select throws_ok($$select public.enqueue_render('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',99,1)$$,'PT409','Stale render inputs','a stale version is a business conflict');
do $$begin
 perform public.enqueue_render('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000604',(select copy_revision from public.campaigns where id='00000000-0000-4000-8000-000000000604'),(select design_revision from public.campaigns where id='00000000-0000-4000-8000-000000000604'));
 insert into render_attempt values('00000000-0000-4000-8000-000000000604','queued');
exception when others then insert into render_attempt values('00000000-0000-4000-8000-000000000604',sqlerrm);
end$$;
select ok((select msg not in ('Human assignment active; admin must cancel it before changing paths','Access denied','Campaign unavailable') from render_attempt),'an old approved assignment no longer blocks the render path');

-- Retire.
select is(private.retire_open_designer_assignments(),2,'both open assignments close, in both workspaces');
select is((select state from public.designer_assignments where campaign_id='00000000-0000-4000-8000-000000000601'),'cancelled','the submitted assignment is kept, cancelled');
select is((select state from public.designer_assignments where campaign_id='00000000-0000-4000-8000-000000000602'),'cancelled','the redo assignment in the other workspace is kept, cancelled');
select is((select array_agg(design_state order by id) from public.campaigns where id in ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000602')),array['unassigned','unassigned'],'their campaigns are back to design not started');
select ok((select bool_and(c.design_revision=b.design_revision+1 and c.delivery_revision=b.delivery_revision+1) from public.campaigns c join before_retire b using(id) where c.id in ('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000602')),'design and delivery versions move on, so an old upload cannot be approved');
select is((select delivery_state from public.campaigns where id='00000000-0000-4000-8000-000000000601'),'not_ready','no delivery is ready without a new design');
select is((select copy_state from public.campaigns where id='00000000-0000-4000-8000-000000000601'),'approved','the owner keeps the copy approval');
select is((select count(*) from public.campaign_events where campaign_id='00000000-0000-4000-8000-000000000601' and action='design_assignment_retired' and actor_id='00000000-0000-4000-8000-000000000001'),1::bigint,'the campaign history says why the design restarted');
select ok((select read_at is not null from public.notifications where entity_id='00000000-0000-4000-8000-000000000601' and kind='design_review'),'the stale "new design ready" notice is marked read');
select is((select array_agg(state order by campaign_id) from public.designer_assignments where campaign_id in ('00000000-0000-4000-8000-000000000603','00000000-0000-4000-8000-000000000604')),array['approved','approved'],'approved assignments stay as history');
select ok((select c.design_state=b.design_state and c.design_revision=b.design_revision from public.campaigns c join before_retire b using(id) where c.id='00000000-0000-4000-8000-000000000603'),'an approved human design is left alone');
select is((select count(*) from public.designer_assignments where state in ('assigned','submitted','revisions_requested')),0::bigint,'no open human assignment is left anywhere');
select is((select count(*) from public.designer_assignments),4::bigint,'no assignment is deleted');

-- Running it again changes nothing.
create temp table after_retire on commit drop as select id,design_state,design_revision,delivery_revision from public.campaigns;
select is(private.retire_open_designer_assignments(),0,'a second run closes nothing');
select is((select count(*) from public.campaigns c join after_retire a using(id) where (c.design_state,c.design_revision,c.delivery_revision) is distinct from (a.design_state,a.design_revision,a.delivery_revision)),0::bigint,'a second run changes no campaign');
select * from finish();rollback;
