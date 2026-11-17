-- UI-LRNa (master handoff sections 10 and 11): the Learned page's owner
-- commands, Remove and Pin. A workspace's owner removes a do or don't the
-- agents learned for it (it is retired, never deleted, and the record says
-- who removed it and when), or pins one: agents read a pinned rule first,
-- whatever its confidence, and it never expires. Only the workspace's own
-- rules: platform and industry rules (tenant_id null) and another
-- workspace's rules are never reachable here. Members keep reading their
-- own rules under the existing row rule; nobody writes the table directly.

alter table public.agent_memory_rules
  add column pinned boolean not null default false,
  add column retired_by uuid references public.profiles(id),
  add column retired_at timestamptz,
  -- Only a workspace's own rule can be pinned; a retired rule is not.
  add constraint agent_memory_rules_pin_scope check (not pinned or (tenant_id is not null and status = 'active'));

-- The owner removes a rule. Lock order: the workspace (require_member),
-- then the rule. The caller passes the revision it read.
create or replace function public.retire_memory_rule(t uuid, rule uuid, expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare m public.agent_memory_rules;
begin
  perform private.require_member(t, true);
  if retire_memory_rule.rule is null or expected_revision is null then
    raise exception 'Invalid request' using errcode = '23514';
  end if;
  select * into m from public.agent_memory_rules r
    where r.id = retire_memory_rule.rule and r.tenant_id = t for update;
  if m.id is null then raise exception 'Rule unavailable' using errcode = '42501'; end if;
  if m.status <> 'active' then raise exception 'Rule is no longer used' using errcode = 'PT409', detail = 'not_active'; end if;
  if m.revision <> expected_revision then raise exception 'Rule changed since it was read' using errcode = 'PT409', detail = 'stale'; end if;
  update public.agent_memory_rules r
    set status = 'retired', pinned = false, retired_by = auth.uid(), retired_at = now(),
      revision = r.revision + 1, updated_at = now()
    where r.id = m.id;
  return m.revision + 1;
end $$;

-- The owner pins or unpins a rule. Pinning an already pinned rule (or
-- unpinning an unpinned one) changes nothing and returns its revision, so
-- a retried click is not a conflict. At
-- most 20 pinned rules per workspace, so every pinned rule fits in one
-- prompt (`maxRulesInPrompt` in features/agents/memory.ts).
create or replace function public.pin_memory_rule(t uuid, rule uuid, expected_revision integer, pinned boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare m public.agent_memory_rules;
begin
  perform private.require_member(t, true);
  if pin_memory_rule.rule is null or expected_revision is null or pin_memory_rule.pinned is null then
    raise exception 'Invalid request' using errcode = '23514';
  end if;
  select * into m from public.agent_memory_rules r
    where r.id = pin_memory_rule.rule and r.tenant_id = t for update;
  if m.id is null then raise exception 'Rule unavailable' using errcode = '42501'; end if;
  if m.status <> 'active' then raise exception 'Rule is no longer used' using errcode = 'PT409', detail = 'not_active'; end if;
  -- Already so (a retried click): nothing to change, whatever revision was read.
  if m.pinned = pin_memory_rule.pinned then return m.revision; end if;
  if m.revision <> expected_revision then raise exception 'Rule changed since it was read' using errcode = 'PT409', detail = 'stale'; end if;
  if pin_memory_rule.pinned and (select count(*) from public.agent_memory_rules r
      where r.tenant_id = t and r.pinned) >= 20 then
    raise exception 'Too many pinned rules' using errcode = 'PT409', detail = 'too_many_pins';
  end if;
  update public.agent_memory_rules r
    set pinned = pin_memory_rule.pinned, revision = r.revision + 1, updated_at = now()
    where r.id = m.id;
  return m.revision + 1;
end $$;

-- The worker (MEM-001) may still weaken a pinned rule, but never expire or
-- retire it: only the owner's Remove ends a pinned rule.
create or replace function public.update_memory_rule(rule_id uuid, expected_revision integer, new_status text, new_confidence numeric) returns integer language plpgsql security definer set search_path='' as $$
declare m public.agent_memory_rules;
begin
 perform private.require_service();
 if new_status is null or new_status not in ('active', 'expired', 'retired') or new_confidence is null or new_confidence < 0 or new_confidence > 1 then
  raise exception 'Invalid rule update' using errcode='23514';
 end if;
 select * into m from public.agent_memory_rules where id = rule_id for update;
 if m.id is null then raise exception 'Rule unavailable' using errcode='42501'; end if;
 if m.revision <> expected_revision then raise exception 'Rule changed since it was read' using errcode='PT409'; end if;
 if m.status <> 'active' and new_status = 'active' then raise exception 'An expired or retired rule cannot come back' using errcode='PT409'; end if;
 if m.pinned and new_status <> 'active' then raise exception 'The owner pinned this rule' using errcode='PT409', detail='pinned'; end if;
 update public.agent_memory_rules set status = new_status, confidence = new_confidence, revision = revision + 1, updated_at = now() where id = rule_id;
 return m.revision + 1;
end $$;

revoke all on function public.retire_memory_rule(uuid, uuid, integer) from public, anon, service_role;
revoke all on function public.pin_memory_rule(uuid, uuid, integer, boolean) from public, anon, service_role;
grant execute on function public.retire_memory_rule(uuid, uuid, integer) to authenticated;
grant execute on function public.pin_memory_rule(uuid, uuid, integer, boolean) to authenticated;
