create or replace function public.subscribe_competitor(t uuid,domain text,label text,private_rules text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare capture uuid;result uuid;
begin
 perform private.require_member(t,true);
 domain:=lower(trim(domain));
 if domain !~ '^[a-z0-9][a-z0-9.-]*\.example$' or length(domain)>200 or length(label) not between 2 and 120 or length(private_rules)>5000 then raise exception 'Use a fictional .example capture domain and valid private rules' using errcode='23514';end if;
 insert into public.competitor_captures(domain) values(domain) on conflict on constraint competitor_captures_domain_key do update set domain=excluded.domain returning id into capture;
 insert into public.competitor_subscriptions(tenant_id,capture_id,label,private_rules,created_by) values(t,capture,label,private_rules,auth.uid()) on conflict(tenant_id,capture_id) do update set active=true,label=excluded.label,private_rules=excluded.private_rules,revision=public.competitor_subscriptions.revision+1 returning id into result;return result;
end $$;
create or replace function public.update_competitor_subscription(t uuid,subscription uuid,expected_revision integer,active boolean,private_rules text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);
 if length(private_rules)>5000 then raise exception 'Rules too long' using errcode='23514';end if;
 update public.competitor_subscriptions s set active=update_competitor_subscription.active,private_rules=update_competitor_subscription.private_rules,revision=revision+1 where s.id=subscription and s.tenant_id=t and s.revision=expected_revision;
 if not found then raise exception 'Stale subscription' using errcode='40001';end if;
end $$;
create or replace function public.enqueue_reference_job(t uuid,kind text,subscription uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.competitor_subscriptions;b public.brand_profiles;input jsonb;j uuid;
begin
 perform private.require_member(t,true);
 if kind='competitors.capture' then
  select * into s from public.competitor_subscriptions where id=subscription and tenant_id=t and active;
  if not found then raise exception 'Active subscription required' using errcode='42501';end if;
  input:=jsonb_build_object('subscriptionId',s.id,'subscriptionRevision',s.revision,'captureId',s.capture_id);
 elsif kind='playbook.synthesize' then
  select * into b from public.brand_profiles where tenant_id=t;
  if not found or b.approved_revision is distinct from b.revision then raise exception 'Approve current brand context' using errcode='23514';end if;
  if (select count(*) from public.competitor_subscriptions sub join public.competitor_captures c on c.id=sub.capture_id where sub.tenant_id=t and sub.active and c.status='live' and (select count(*) from public.competitor_emails e where e.capture_id=c.id)>=10)<3 then raise exception 'Three LIVE competitors with ten emails each are required' using errcode='23514';end if;
  input:=jsonb_build_object('brandRevision',b.revision,'subscriptionRevisions',(select jsonb_object_agg(sub.id::text,sub.revision) from public.competitor_subscriptions sub where sub.tenant_id=t and sub.active));
 else raise exception 'Unsupported reference job' using errcode='23514';end if;
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,kind,kind||':'||encode(extensions.digest(input::text,'sha256'),'hex'),input,auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;
create or replace function public.finish_capture_job(job uuid,lease uuid,output jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;s public.competitor_subscriptions;x jsonb;sequence jsonb;ids uuid[];html text;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind<>'competitors.capture' or (output->>'synthetic')::boolean is distinct from true or jsonb_typeof(output->'records') is distinct from 'array' or jsonb_array_length(output->'records')>10 then raise exception 'Invalid fixture capture output' using errcode='23514';end if;
 select * into s from public.competitor_subscriptions where id=(j.input->>'subscriptionId')::uuid and tenant_id=j.tenant_id and active for update;
 if not found or s.revision is distinct from (j.input->>'subscriptionRevision')::integer or s.capture_id is distinct from (j.input->>'captureId')::uuid then raise exception 'Subscription changed' using errcode='40001';end if;
 perform 1 from public.competitor_captures where id=s.capture_id for update;
 for x in select value from jsonb_array_elements(output->'records') loop
  if x->>'externalId' !~ '^fixture-v1-[0-9]$' or jsonb_typeof(x->'micro') is distinct from 'object' or (x->'micro'->>'synthetic')::boolean is distinct from true then raise exception 'Invalid synthetic record' using errcode='23514';end if;
  if not ((x->'micro') ?& array['offerCode','product','theme','strips','discountPercent','sequenceHint','synthetic']) or jsonb_typeof(x->'micro'->'strips') is distinct from 'array' or jsonb_array_length(x->'micro'->'strips')>10 or coalesce(length(x->'micro'->>'theme'),0) not between 1 and 100 or (x->'micro'->>'discountPercent')::numeric not between 0 and 100 or (x->>'receivedAt')::timestamptz>now() then raise exception 'Invalid structured extraction' using errcode='23514';end if;
  -- No caller HTML is rendered or stored. All dynamic text is escaped by the server.
  html:='<!doctype html><html><body style="font-family:Arial;padding:24px"><p>Synthetic reference · text-only safe preview</p><h1>'||private.escape_html(x->>'subject')||'</h1><pre style="white-space:pre-wrap">'||private.escape_html(x->>'text')||'</pre></body></html>';
  insert into public.competitor_emails(capture_id,external_id,received_at,subject,text_content,safe_html,micro) values(s.capture_id,x->>'externalId',(x->>'receivedAt')::timestamptz,x->>'subject',x->>'text',html,x->'micro') on conflict(capture_id,external_id) do nothing;
 end loop;
 if jsonb_typeof(output->'sequences') is distinct from 'array' then raise exception 'Sequence extraction required' using errcode='23514';end if;
 for sequence in select value from jsonb_array_elements(output->'sequences') loop
  select array_agg(e.id order by e.received_at) into ids from public.competitor_emails e where e.capture_id=s.capture_id and e.external_id in (select jsonb_array_elements_text(sequence->'externalIds'));
  if ids is null then raise exception 'Sequence evidence unavailable' using errcode='23514';end if;
  insert into public.competitor_sequences(capture_id,key,evidence_ids,confidence,pattern) values(s.capture_id,sequence->>'key',ids,sequence->>'confidence',sequence->>'pattern') on conflict(capture_id,key) do nothing;
 end loop;
 update public.competitor_captures set status=case when (select count(*) from public.competitor_emails e where e.capture_id=s.capture_id)>=10 then 'live' else 'degraded' end,last_received_at=(select max(received_at) from public.competitor_emails e where e.capture_id=s.capture_id),cursor='fixture-v1',last_error=null where id=s.capture_id;
 update public.job_runs set status='succeeded',lease_token=null,lease_until=null,checkpoint=jsonb_build_object('captureId',s.capture_id,'synthetic',true,'captured',(select count(*) from public.competitor_emails where capture_id=s.capture_id)),updated_at=now() where id=j.id;
end $$;
create or replace function public.finish_playbook_job(job uuid,lease uuid,output jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;b public.brand_profiles;ids uuid[];sources integer;revision integer;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind<>'playbook.synthesize' or (output->>'synthetic')::boolean is distinct from true or jsonb_typeof(output->'patterns') is distinct from 'array' or jsonb_array_length(output->'patterns') not between 1 and 10 or jsonb_typeof(output->'evidenceIds') is distinct from 'array' then raise exception 'Invalid playbook output' using errcode='23514';end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 select * into b from public.brand_profiles where tenant_id=j.tenant_id;
 if b.revision is distinct from (j.input->>'brandRevision')::integer or b.approved_revision is distinct from b.revision then raise exception 'Brand context changed' using errcode='40001';end if;
 if exists(select 1 from jsonb_each(j.input->'subscriptionRevisions') r where not exists(select 1 from public.competitor_subscriptions s where s.id=r.key::uuid and s.tenant_id=j.tenant_id and s.active and s.revision=(r.value::text)::integer)) then raise exception 'Subscription context changed' using errcode='40001';end if;
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(output->'evidenceIds');
 if cardinality(ids)<30 or exists(select 1 from unnest(ids) as evidence(id) where not exists(select 1 from public.competitor_emails e join public.competitor_subscriptions s on s.capture_id=e.capture_id where e.id=evidence.id and s.tenant_id=j.tenant_id and s.active)) then raise exception 'Insufficient authorized evidence' using errcode='23514';end if;
 select count(*) into sources from (select e.capture_id from public.competitor_emails e where e.id=any(ids) group by e.capture_id having count(distinct e.id)>=10) q;
 if sources<3 then raise exception 'Incomplete source coverage' using errcode='23514';end if;
 select coalesce(max(p.revision),0)+1 into revision from public.playbooks p where tenant_id=j.tenant_id;
 insert into public.playbooks(tenant_id,revision,brand_revision,patterns,evidence_ids,subscription_revisions,source_count,created_by) values(j.tenant_id,revision,b.revision,output->'patterns',ids,j.input->'subscriptionRevisions',sources,j.created_by);
 insert into public.ai_calls(tenant_id,job_id,feature,prompt_version,provider,status,input_tokens,output_tokens,input_revisions) values(j.tenant_id,j.id,'playbook','fixture-playbook-v1','fixture','succeeded',0,0,jsonb_build_object('brand',b.revision)) on conflict(job_id) do nothing;
 update public.job_runs set status='succeeded',lease_token=null,lease_until=null,checkpoint=jsonb_build_object('playbookRevision',revision,'synthetic',true),updated_at=now() where id=j.id;
end $$;
do $$ declare f text; begin foreach f in array array['public.subscribe_competitor(uuid,text,text,text)','public.update_competitor_subscription(uuid,uuid,integer,boolean,text)','public.enqueue_reference_job(uuid,text,uuid)','public.finish_capture_job(uuid,uuid,jsonb)','public.finish_playbook_job(uuid,uuid,jsonb)'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;
