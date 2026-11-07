-- GEM-002: live AI usage (Gemini, decision D5) is metered through
-- service-role-only commands, and the owner-callable fixture commands can no
-- longer touch it. Before this, reserve_fixture_usage / reconcile_fixture_usage
-- (granted to authenticated owners) were the only way to meter runAi calls, so
-- an owner could release a live reservation and erase real spend.

-- 1. Alerts and the cap message tell the truth for live `ai:` operations.
CREATE OR REPLACE FUNCTION private.reserve_budget (
  t         uuid,
  operation text,
  feature   text,
  estimate  bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare c public.package_cycles;r public.usage_reservations;d date;daily bigint;alert text;live boolean;
begin
 if operation is null or length(operation) not between 1 and 200 or feature is null or feature not in ('copy','design','assets','playbook','calendar','gros','learning') or estimate is null or estimate<1 or estimate>1000000000 then raise exception 'Invalid usage request' using errcode='23514';end if;
 live:=operation like 'email-rewrite:%' or operation like 'ai:%';
 c:=private.ensure_package_cycle(t);
 d:=(now() at time zone (select timezone from public.tenants where id=t))::date;
 select * into r from public.usage_reservations where tenant_id=t and operation_id=operation for update;
 if r.id is not null then
  if r.feature<>feature or r.estimate_micro<>estimate then raise exception 'Usage operation identity changed' using errcode='PT409';end if;
  if r.state in ('reserved','reconciled') then return r.id;end if;
 end if;
 select coalesce(sum(case when state='reserved' then estimate_micro when state='reconciled' then actual_micro else 0 end),0) into daily from public.usage_reservations where cycle_id=c.id and local_date=d;
 if c.used_micro+c.reserved_micro+estimate>c.allocation_micro or daily+estimate>c.daily_micro then
  raise exception '%',case when live then 'AI usage allowance reached; no AI request was sent' else 'Fixture AI budget exhausted; approved delivery remains available' end using errcode='23514';
 end if;
 insert into public.usage_reservations(tenant_id,cycle_id,operation_id,feature,estimate_micro,local_date) values(t,c.id,operation,feature,estimate,d) on conflict(tenant_id,operation_id) do update set cycle_id=excluded.cycle_id,state='reserved',actual_micro=null,local_date=excluded.local_date,expires_at=now()+interval '10 minutes' returning * into r;
 update public.package_cycles set reserved_micro=reserved_micro+estimate where id=c.id;
 foreach alert in array array[case when c.used_micro+c.reserved_micro+estimate>=c.allocation_micro*0.8 then 'cycle' end,case when daily+estimate>=c.daily_micro*0.8 then 'day:'||d end] loop
 if alert is not null then
 insert into public.budget_alerts(cycle_id,tenant_id,window_key) values(c.id,t,alert) on conflict do nothing;
 if found then perform private.notify_owners(t,'budget_soft_alert',c.id,case when live
   then 'AI usage reached 80% of the '||alert||' allowance, including real AI requests.'
   else 'Synthetic fixture usage reached 80% of '||alert||' allowance. No paid provider was called.' end);end if;
 end if;end loop;return r.id;
end $function$;

CREATE OR REPLACE FUNCTION private.settle_email_dispatch (

-- 2. A closed reservation is a business conflict (PT409), not a
--    serialization failure: custom 40001 makes PostgREST retry forever.
create or replace function private.reconcile_budget(t uuid,reservation uuid,actual bigint) returns void language plpgsql security definer set search_path='' as $$
declare r public.usage_reservations;
begin
 perform 1 from public.tenants where id=t for update;
 select * into r from public.usage_reservations where id=reservation and tenant_id=t for update;
 if r.id is null or actual is null or actual<0 or actual>r.estimate_micro then raise exception 'Actual usage must fit reservation' using errcode='23514';end if;
 if r.state='reconciled' and r.actual_micro=actual then return;end if;
 if r.state<>'reserved' then raise exception 'Usage reservation already closed' using errcode='PT409';end if;
 update public.package_cycles set reserved_micro=reserved_micro-r.estimate_micro,used_micro=used_micro+actual where id=r.cycle_id;
 update public.usage_reservations set state=case when actual=0 then 'released' else 'reconciled' end,actual_micro=actual where id=r.id;
end $$;

-- 3. Live AI usage: service role only, `ai:` operations only, one
--    reservation per operation (a retry must reserve again), and never
--    auto-released by expiry (an unsettled live call keeps counting at its
--    estimate until ops settles it).
create or replace function public.reserve_ai_usage(t uuid,operation text,feature text,estimate bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Access denied' using errcode='42501';end if;
 if not exists(select 1 from public.tenants where tenants.id=t and status='active') then raise exception 'Active workspace required' using errcode='42501';end if;
 if operation is null or operation not like 'ai:%' then raise exception 'Live AI operation required' using errcode='23514';end if;
 if exists(select 1 from public.usage_reservations u where u.tenant_id=t and u.operation_id=operation) then
  raise exception 'AI operation already reserved' using errcode='PT409';
 end if;
 id:=private.reserve_budget(t,operation,feature,estimate);
 update public.usage_reservations set expires_at='infinity' where usage_reservations.id=id;
 return id;
end $$;

create or replace function public.settle_ai_usage(t uuid,reservation uuid,actual bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Access denied' using errcode='42501';end if;
 if not exists(select 1 from public.usage_reservations u where u.id=reservation and u.tenant_id=t and u.operation_id like 'ai:%') then
  raise exception 'Live AI reservation required' using errcode='42501';
 end if;
 perform private.reconcile_budget(t,reservation,actual);
end $$;

-- 4. The owner-callable fixture commands refuse live AI operations, as they
--    already refuse email-rewrite ones.
create or replace function public.reserve_fixture_usage(t uuid,operation text,feature text,estimate bigint) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 if operation like 'email-rewrite:%' or operation like 'ai:%' then raise exception 'Access denied' using errcode='42501';end if;
 return private.reserve_budget(t,operation,feature,estimate);
end $$;

create or replace function public.reconcile_fixture_usage(t uuid,reservation uuid,actual bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 if exists(select 1 from public.usage_reservations u where u.id=reservation and (u.operation_id like 'email-rewrite:%' or u.operation_id like 'ai:%'))
   or exists(select 1 from private.email_dispatches d where d.reservation_id=reservation) then
   raise exception 'Access denied' using errcode='42501';
 end if;
 perform private.reconcile_budget(t,reservation,actual);
end $$;

revoke all on function public.reserve_ai_usage(uuid,text,text,bigint),public.settle_ai_usage(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,text,text,bigint),public.settle_ai_usage(uuid,uuid,bigint) to service_role;
