-- RET-001 (decision D3, docs/BUILD_BRIEF.md): there is no human designer.
-- The AI builds every email, and the automatic render path makes the design
-- the owner approves. Not destructive: no table, column or row is dropped;
-- approved and cancelled assignments, submissions and reviews stay as
-- history. Running it again changes nothing.
--
-- 1. enqueue_render (copied from 20260914090006_render_commands.sql) now
--    refuses only while a human assignment is OPEN. An approved one is
--    history: copy edits, rejections and brand-fact corrections send a
--    campaign back to "design not started" but keep it, and with the admin
--    Designers page retired nothing could clear it. create_delivery_package
--    already prefers a current render over an old submission. A stale
--    version is now PT409 (business conflict), not 40001.
create or replace function public.enqueue_render(t uuid,campaign uuid,expected_copy integer,expected_design integer,source text default 'fixture_structure',source_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;b public.brand_profiles;k public.brand_kits;assets jsonb;input jsonb;j uuid;prior public.design_renders;feedback public.render_reviews;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_revision is distinct from expected_copy or c.design_revision is distinct from expected_design then raise exception 'Stale render inputs' using errcode='PT409';end if;
 if c.calendar_state<>'approved' or c.copy_state<>'approved' or c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Current copy approval required or delivery active' using errcode='23514';end if;
 if exists(select 1 from public.designer_assignments where campaign_id=c.id and state in ('assigned','submitted','revisions_requested')) then raise exception 'Human assignment active; admin must cancel it before changing paths' using errcode='23514';end if;
 perform private.assert_campaign_guards(c);
 if source not in ('fixture_structure','own_template','reference_structure') or (source='own_template' and not exists(select 1 from public.own_templates x where x.id=source_id and x.tenant_id=t)) or (source='reference_structure' and not exists(select 1 from public.competitor_emails e where e.id=source_id and private.capture_access(e.capture_id))) then raise exception 'Authorized structure required' using errcode='42501';end if;
 select * into b from public.brand_profiles where tenant_id=t;
 select * into k from public.brand_kits where tenant_id=t;
 if c.channel='email_design' and (k.approved_by is null or cardinality(k.colors)=0 or cardinality(k.fonts)=0) then raise exception 'Approve brand kit before image rendering' using errcode='23514';end if;
 select coalesce(jsonb_object_agg(a.id::text,a.revision),'{}') into assets from (select * from public.assets where tenant_id=t and category in ('logo','product','lifestyle','proof') and (product_id is null or product_id=c.product_id) order by case when category='logo' then 0 else 1 end,id limit 3) a;
 if c.channel='email_design' and assets='{}' then raise exception 'Usable approved-input assets required' using errcode='23514';end if;
 select * into prior from public.design_renders where campaign_id=c.id and revision=c.design_revision;
 if c.design_state='revisions_requested' then select * into feedback from public.render_reviews where render_id=prior.id and decision='revision' order by created_at desc limit 1;end if;
 input:=jsonb_build_object('brand',b.revision,'kit',k.revision,'assets',case when c.channel='email_text' then '{}'::jsonb else assets end,'channel',c.channel,'calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision,'source',source,'sourceId',source_id,'structure',case when source='reference_structure' then (select micro->'strips' from public.competitor_emails where id=source_id) when source='own_template' then (select skeleton->'sections' from public.own_templates where id=source_id and tenant_id=t) else jsonb_build_array('Hero','Copy','CTA') end,'baseRenderId',prior.id,'section',feedback.section,'feedback',feedback.feedback);
 if not private.render_inputs_current(t,input) then raise exception 'Current private assets and approved kit required' using errcode='23514';end if;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'design.render','render:'||c.id||':'||c.copy_revision||':'||c.design_revision||':'||encode(extensions.digest(input::text,'sha256'),'hex'),input,auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;

-- 2. No new human assignments: the admin Designers page is retired.
revoke execute on function public.assign_campaign(uuid,uuid,uuid,integer) from public, anon, authenticated;

-- 3. Close every open human assignment once, like an owner rejection
--    (planning commands): the assignment is cancelled, the campaign's
--    design goes back to not started with its design and delivery versions
--    moved on, and the campaign history records why. Locks follow the repo
--    order (tenant, then campaign, then assignment); every statement takes a
--    fresh snapshot, so an assignment made while this waits is closed too.
create or replace function private.retire_open_designer_assignments()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  c public.campaigns;
  closed_count integer := 0;
begin
  perform 1 from public.tenants t
  where exists (
    select 1 from public.designer_assignments a
    where a.tenant_id = t.id
      and a.state in ('assigned', 'submitted', 'revisions_requested')
  )
  order by t.id
  for update;
  for c in
    select campaign.* from public.campaigns campaign
    where exists (
      select 1 from public.designer_assignments a
      where a.campaign_id = campaign.id
        and a.state in ('assigned', 'submitted', 'revisions_requested')
    )
    order by campaign.tenant_id, campaign.id
    for update
  loop
    update public.designer_assignments
    set state = 'cancelled', updated_at = now()
    where campaign_id = c.id
      and state in ('assigned', 'submitted', 'revisions_requested');
    -- An open human assignment means its design was never approved, so no
    -- delivery is active and the campaign is safe to reset.
    update public.campaigns
    set design_revision = design_revision + 1,
      design_state = 'unassigned',
      delivery_revision = delivery_revision + 1,
      delivery_state = 'not_ready',
      updated_at = now()
    where id = c.id
      and design_state in ('assigned', 'submitted', 'revisions_requested');
    insert into public.campaign_events(tenant_id, campaign_id, actor_id, action, detail)
    values (c.tenant_id, c.id, c.created_by, 'design_assignment_retired',
      jsonb_build_object('reason', 'designer workflow retired (decision D3)',
        'designState', c.design_state, 'designRevision', c.design_revision));
    -- "A new design version is ready" no longer points at anything.
    update public.notifications
    set read_at = now()
    where entity_id = c.id and kind = 'design_review' and read_at is null;
    closed_count := closed_count + 1;
  end loop;
  raise notice 'RET-001: closed open designer assignments on % campaigns', closed_count;
  return closed_count;
end
$$;

revoke all on function private.retire_open_designer_assignments()
from public, anon, authenticated;

select private.retire_open_designer_assignments();
