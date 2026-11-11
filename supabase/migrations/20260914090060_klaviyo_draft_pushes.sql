-- PSH-001: the live Klaviyo push of one built email as a DRAFT campaign.
--
-- One row per planned email's push key (EML-004 part 2's `push_key`)
-- remembers each step the live DraftPusher has made in Klaviyo, so a push
-- that stops half way (a timeout, Klaviyo's pace, a crash) is picked up
-- where it was and never makes a second picture, template or campaign:
-- the pictures imported (their address in Klaviyo), the templates, the
-- campaign and its message, which designs went in (both, or A only after
-- Klaviyo refused an even A/B test), and the final checks on the HTML sent.
--
-- Only the worker writes it, and only under the exact push lease of the
-- email's build; members of the workspace (and platform operators, as for
-- the builds) read it. Nothing here schedules or sends (D17: the owner
-- schedules in Klaviyo).
--
-- The number is chosen at merge time (D24).

create table public.klaviyo_draft_pushes (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  push_key uuid not null,
  state text not null default 'started'
    check (state in ('started', 'drafted', 'refused')),
  -- Each picture's address in the email -> its address in Klaviyo (pictures
  -- of every build of this planned email: at most 5 builds of 40 each).
  images jsonb not null default '{}'::jsonb
    check (jsonb_typeof(images) = 'object' and octet_length(images::text) <= 900000),
  -- Our templates: [{ "approach": "A", "id": "...", "hash": "...", "deleted": false,
  -- "variation": "..." }] (the variation it was put on, once it is).
  templates jsonb not null default '[]'::jsonb
    check (jsonb_typeof(templates) = 'array' and jsonb_array_length(templates) <= 20),
  campaign_id text check (campaign_id is null or campaign_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  message_id text check (message_id is null or message_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- When a campaign create was sent: its answer may be lost, so a retry
  -- looks for the campaign made since then before making one.
  create_started_at timestamptz,
  -- When a message create was sent and not yet saved (never sent again
  -- while it may still appear).
  message_started_at timestamptz,
  -- When a template create was sent and not yet saved (found by its name).
  template_started_at timestamptz,
  -- When Klaviyo first answered a delete of design B it did not show done
  -- (the push waits for it, at most 10 minutes).
  delete_answered_at timestamptz,
  -- The list or segment the campaign was made for (it never changes).
  audience_id text check (audience_id is null or audience_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  designs text check (designs is null or designs in ('both', 'A')),
  -- Why only design A went in (Klaviyo refused or changed the even test).
  fallback text check (fallback is null or fallback ~ '^[a-z][a-z_]{1,39}$'),
  -- `pending`: an A/B message was sent for and not yet seen safe (two designs, no winner)
  -- (a push that stops there takes B out before anything else).
  ab text check (ab is null or ab in ('pending', 'verified')),
  -- The final checks on the HTML sent: [{ "id": "images", "pass": true, "problems": [] }].
  checks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checks) = 'array' and octet_length(checks::text) <= 20000),
  reason text check (reason is null or reason ~ '^[a-z][a-z_]{1,39}$'),
  -- Fingerprints of the draft's variations as Klaviyo showed them after our
  -- last write (one per variation: its subject and preview), and those this
  -- push is taking them to: a draft showing anything else was changed in
  -- Klaviyo and is never overwritten.
  written text check (written is null or written ~ '^[a-f0-9]{16}(,[a-f0-9]{16}){0,7}$'),
  target text check (target is null or target ~ '^[a-f0-9]{16}(,[a-f0-9]{16}){0,7}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, push_key),
  check (message_id is null or campaign_id is not null),
  check (state <> 'drafted' or (campaign_id is not null and designs is not null)),
  check (state <> 'refused' or reason is not null)
);

alter table public.klaviyo_draft_pushes enable row level security;
create policy klaviyo_draft_pushes_member_read on public.klaviyo_draft_pushes for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
-- Written only through `save_klaviyo_push`, by the worker too.
revoke all on public.klaviyo_draft_pushes from public, anon, authenticated, service_role;
grant select on public.klaviyo_draft_pushes to authenticated;
grant select on public.klaviyo_draft_pushes to service_role;

-- One step of a push, saved by the worker under the exact push lease of
-- the email's build (`private.leased_email_build`, EML-004 part 2): a run
-- whose lease ran out, or that never had it, saves nothing, so two runs
-- never both make a campaign. `step` names the columns it sets; each is
-- checked. What a push made stays made: its campaign and message, its
-- audience, its first create time, design A once Klaviyo refused the even
-- test, and a push closed because the owner changed or deleted its draft
-- in Klaviyo. Locks: the tenant first, then
-- the build, then the push row.
create or replace function public.save_klaviyo_push(build uuid, lease uuid, step jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['state', 'images', 'templates', 'campaign_id', 'message_id', 'create_started_at',
    'message_started_at', 'template_started_at', 'delete_answered_at', 'audience_id', 'designs', 'fallback', 'ab',
    'checks', 'reason', 'written', 'target'];
  texts constant text[] := array['state', 'campaign_id', 'message_id', 'create_started_at', 'message_started_at',
    'template_started_at', 'delete_answered_at', 'audience_id', 'designs', 'fallback', 'ab', 'reason', 'written',
    'target'];
  t uuid; key uuid; cur public.klaviyo_draft_pushes;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if build is null or lease is null or jsonb_typeof(step) is distinct from 'object' or step = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(step) k where k <> all (allowed))
    or exists (select 1 from unnest(texts) k where step ? k and jsonb_typeof(step->k) not in ('string', 'null')) then
    raise exception 'Invalid push step' using errcode = '23514';
  end if;
  select b.tenant_id, b.push_key into t, key from public.email_builds b where b.id = build;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for share;
  -- The caller's own build, in its push step, with its unexpired lease.
  perform private.leased_email_build(build, lease, 'push_queued');
  if (step ? 'state' and coalesce(step->>'state', '') not in ('started', 'drafted', 'refused'))
    or (step ? 'images' and (jsonb_typeof(step->'images') <> 'object'
      or (select count(*) from jsonb_object_keys(step->'images')) > 40
      or exists (select 1 from jsonb_each(step->'images') i
        where length(i.key) not between 9 and 2000 or jsonb_typeof(i.value) <> 'string'
          or length(i.value #>> '{}') > 2000 or i.value #>> '{}' !~ '^https://[^\s"''<>]+$')))
    or (step ? 'templates' and (jsonb_typeof(step->'templates') <> 'array' or jsonb_array_length(step->'templates') > 20
      or exists (select 1 from jsonb_array_elements(step->'templates') x
        where jsonb_typeof(x) <> 'object' or x - 'approach' - 'id' - 'hash' - 'deleted' - 'variation' <> '{}'::jsonb
          or coalesce(x->>'approach', '') not in ('A', 'B')
          or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[A-Za-z0-9_-]{1,64}$'
          or jsonb_typeof(x->'hash') is distinct from 'string' or x->>'hash' !~ '^[a-f0-9]{64}$'
          or jsonb_typeof(x->'deleted') is distinct from 'boolean'
          or (x ? 'variation' and x->'variation' <> 'null'::jsonb
            and (jsonb_typeof(x->'variation') <> 'string' or x->>'variation' !~ '^[A-Za-z0-9_-]{1,64}$')))))
    or (step ? 'campaign_id' and step->'campaign_id' <> 'null'::jsonb and step->>'campaign_id' !~ '^[A-Za-z0-9_-]{1,64}$')
    or (step ? 'message_id' and step->'message_id' <> 'null'::jsonb and step->>'message_id' !~ '^[A-Za-z0-9_-]{1,64}$')
    or (step ? 'create_started_at' and step->'create_started_at' <> 'null'::jsonb
      and private.safe_time(step->>'create_started_at') is null)
    or (step ? 'template_started_at' and step->'template_started_at' <> 'null'::jsonb
      and private.safe_time(step->>'template_started_at') is null)
    or (step ? 'message_started_at' and step->'message_started_at' <> 'null'::jsonb
      and private.safe_time(step->>'message_started_at') is null)
    or (step ? 'delete_answered_at' and step->'delete_answered_at' <> 'null'::jsonb
      and private.safe_time(step->>'delete_answered_at') is null)
    or (step ? 'audience_id' and step->'audience_id' <> 'null'::jsonb and step->>'audience_id' !~ '^[A-Za-z0-9_-]{1,64}$')
    or (step ? 'ab' and step->'ab' <> 'null'::jsonb and step->>'ab' not in ('pending', 'verified'))
    or (step ? 'target' and step->'target' <> 'null'::jsonb and step->>'target' !~ '^[a-f0-9]{16}(,[a-f0-9]{16}){0,7}$')
    or (step ? 'designs' and step->'designs' <> 'null'::jsonb and step->>'designs' not in ('both', 'A'))
    or (step ? 'fallback' and step->'fallback' <> 'null'::jsonb and step->>'fallback' !~ '^[a-z][a-z_]{1,39}$')
    or (step ? 'reason' and step->'reason' <> 'null'::jsonb and step->>'reason' !~ '^[a-z][a-z_]{1,39}$')
    or (step ? 'written' and step->'written' <> 'null'::jsonb and step->>'written' !~ '^[a-f0-9]{16}(,[a-f0-9]{16}){0,7}$')
    or (step ? 'checks' and (jsonb_typeof(step->'checks') <> 'array' or jsonb_array_length(step->'checks') > 6
      or octet_length((step->'checks')::text) > 20000
      or exists (select 1 from jsonb_array_elements(step->'checks') x
        where jsonb_typeof(x) <> 'object' or x - 'id' - 'pass' - 'problems' <> '{}'::jsonb
          or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[a-z][a-z_]{1,39}$'
          or jsonb_typeof(x->'pass') is distinct from 'boolean'
          or jsonb_typeof(x->'problems') is distinct from 'array' or jsonb_array_length(x->'problems') > 10
          or exists (select 1 from jsonb_array_elements(x->'problems') p
            where jsonb_typeof(p) <> 'string' or length(p #>> '{}') > 300)))) then
    raise exception 'Invalid push step' using errcode = '23514';
  end if;
  select * into cur from public.klaviyo_draft_pushes p where p.tenant_id = t and p.push_key = key for update;
  if found then
    -- What a push made stays made.
    if (cur.state = 'refused' and cur.reason = 'externally_modified')
      or (step ? 'state' and step->>'state' = 'started')
      or (step ? 'campaign_id' and cur.campaign_id is not null and step->>'campaign_id' is distinct from cur.campaign_id)
      or (step ? 'message_id' and cur.message_id is not null and step->>'message_id' is distinct from cur.message_id)
      or (step ? 'audience_id' and cur.audience_id is not null and step->>'audience_id' is distinct from cur.audience_id)
      or (step ? 'create_started_at' and cur.create_started_at is not null
        and (step->>'create_started_at')::timestamptz is distinct from cur.create_started_at)
      or (step ? 'designs' and cur.designs = 'A' and cur.fallback is not null
        and step->>'designs' is distinct from 'A') then
      raise exception 'This push cannot go back' using errcode = 'PT409';
    end if;
  else
    insert into public.klaviyo_draft_pushes (tenant_id, push_key) values (t, key);
  end if;
  update public.klaviyo_draft_pushes p set
      state = case when step ? 'state' then step->>'state' else p.state end,
      images = case when step ? 'images' then p.images || (step->'images') else p.images end,
      templates = case when step ? 'templates' then step->'templates' else p.templates end,
      campaign_id = case when step ? 'campaign_id' then step->>'campaign_id' else p.campaign_id end,
      message_id = case when step ? 'message_id' then step->>'message_id' else p.message_id end,
      create_started_at = case when step ? 'create_started_at' then (step->>'create_started_at')::timestamptz
        else p.create_started_at end,
      template_started_at = case when step ? 'template_started_at' then (step->>'template_started_at')::timestamptz
        else p.template_started_at end,
      message_started_at = case when step ? 'message_started_at' then (step->>'message_started_at')::timestamptz
        else p.message_started_at end,
      delete_answered_at = case when step ? 'delete_answered_at' then (step->>'delete_answered_at')::timestamptz
        else p.delete_answered_at end,
      audience_id = case when step ? 'audience_id' then step->>'audience_id' else p.audience_id end,
      ab = case when step ? 'ab' then step->>'ab' else p.ab end,
      target = case when step ? 'target' then step->>'target' else p.target end,
      designs = case when step ? 'designs' then step->>'designs' else p.designs end,
      fallback = case when step ? 'fallback' then step->>'fallback' else p.fallback end,
      checks = case when step ? 'checks' then step->'checks' else p.checks end,
      reason = case when step ? 'reason' then step->>'reason' else p.reason end,
      written = case when step ? 'written' then step->>'written' else p.written end,
      updated_at = now()
    where p.tenant_id = t and p.push_key = key;
end $$;

revoke all on function public.save_klaviyo_push(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_klaviyo_push(uuid, uuid, jsonb) to service_role;
