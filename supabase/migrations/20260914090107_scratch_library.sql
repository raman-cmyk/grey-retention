-- DES-ENGINE-004b (step 4 of the email design plan, "Scratch from the real
-- library", owner decisions of 25 Nov): a Scratch email's design step picks
-- its sections from the whole block library (090106) and the design copies
-- job draws them in the brand's look, as it draws a library copy. Behind
-- the owner's switch DESIGN_LIBRARY_SCRATCH (off in production).
--
-- * email_copies.blocks: a Scratch copy is of library blocks, in order (1
--   to 12): exactly one of an inspiration email, an upload or blocks.
-- * request_email_copy(…, blocks): a Scratch build (mode 'scratch', no
--   reference, no upload) asks for its copy from blocks it may use: passed
--   the quality gate, shared or the workspace's own private ones, never one
--   the workspace hid. Otherwise as in 090105 (its signature grows a
--   seventh argument with a default; the six-argument command is replaced).
-- * Which blocks a workspace may use, one rule everywhere (the library
--   screen, the Scratch planner and the copy request): a block that passed
--   the quality gate, not hidden by the workspace, and either its own
--   private block (its upload still ready) or a shared block used by an
--   Inspiration email the workspace may use, on Copy's terms
--   (a brand it follows and has not hidden, or a sample brand's email for a
--   sample workspace). The app applies the Observer selection on top and
--   checks it all again when the copy is made (`library_blocks_for`).
-- * park_email_copy: a copy job whose kind's switch is off waits an hour
--   (`switch_off`), its try given back.
-- * library_block_hides: "Don't use this layout" on the library screen, per
--   workspace. The owner and admins hide and show again
--   (`set_library_block_hidden`, tenant first); members read their own
--   workspace's hides; the planner never picks a hidden layout.
-- * The number is chosen at merge time (D24).

alter table public.email_copies
  add column blocks uuid[] check (blocks is null or cardinality(blocks) between 1 and 12),
  drop constraint email_copies_one_source,
  add constraint email_copies_one_source check (num_nonnulls(inbox_message_id, upload_id, blocks) = 1);

create table public.library_block_hides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  block_id uuid not null references public.library_blocks(id) on delete cascade,
  hidden_by uuid not null references public.profiles(id),
  hidden_at timestamptz not null default now(),
  primary key (tenant_id, block_id)
);
alter table public.library_block_hides enable row level security;
create policy library_block_hides_member_read on public.library_block_hides for select to authenticated
  using ((select private.is_active_member(tenant_id)) or (select private.is_operator()));
revoke all on public.library_block_hides from public, anon, authenticated, service_role;
grant select on public.library_block_hides to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.library_block_hides from public, anon, authenticated, service_role';
  end if;
end $$;

-- Whether a workspace may use an inspiration email's design (Copy's rule:
-- a brand it follows and has not hidden, or a sample email for a sample
-- workspace).
create or replace function private.email_usable(t uuid, message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.competitor_emails e
    where e.inbox_message_id = message
      and not exists (select 1 from public.competitor_hidden h where h.tenant_id = t and h.capture_id = e.capture_id)
      and (exists (select 1 from public.competitor_subscriptions s
                   where s.tenant_id = t and s.capture_id = e.capture_id and s.active)
           or (e.synthetic and exists (select 1 from public.brand_profiles p where p.tenant_id = t and p.synthetic))))
$$;
revoke all on function private.email_usable(uuid, uuid) from public, anon, authenticated, service_role;

-- Whether a workspace may build with a block (the rule above), hidden or
-- not: a shared block when any email that used its layout is one the
-- workspace may use (so a layout never vanishes because the email its
-- geometry came from was hidden or withdrawn, while another allowed email
-- has it), its own private block while its geometry's upload is ready.
create or replace function private.library_block_visible(t uuid, b public.library_blocks)
returns boolean language sql stable security definer set search_path = '' as $$
  select b.quality = 'passed' and (
    (b.tenant_id = t and exists (select 1 from public.email_uploads u
                                 where u.id = b.geometry_upload and u.tenant_id = t and u.state = 'ready'))
    or (b.tenant_id is null and exists (select 1 from public.library_block_sources s
                                        where s.block_id = b.id and s.inbox_message_id is not null
                                          and private.email_usable(t, s.inbox_message_id))))
$$;

-- The emails that used a shared block's layout and the workspace may use
-- (its geometry's first), at most 20: the app's Observer check keeps the
-- block when one of them is allowed.
create or replace function private.library_block_emails(t uuid, b public.library_blocks)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'message', x.inbox_message_id, 'external_id', x.external_id,
      'synthetic', x.synthetic) order by x.first desc, x.id), '[]'::jsonb)
  from (select y.* from (
          select distinct on (e.id) e.id, e.inbox_message_id, e.external_id, e.synthetic,
            e.inbox_message_id is not distinct from b.geometry_message as first
          from public.library_block_sources s join public.competitor_emails e on e.inbox_message_id = s.inbox_message_id
          where b.tenant_id is null and s.block_id = b.id and private.email_usable(t, s.inbox_message_id)
          order by e.id) y
        -- The geometry's email first, then the rest: the cut keeps it.
        order by y.first desc, y.id
        limit 20) x
$$;
revoke all on function private.library_block_emails(uuid, public.library_blocks) from public, anon, authenticated, service_role;
revoke all on function private.library_block_visible(uuid, public.library_blocks) from public, anon, authenticated, service_role;

-- Whether a workspace may build with a block now: visible and not hidden.
create or replace function private.library_block_usable(t uuid, block uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.library_blocks b
    where b.id = block and private.library_block_visible(t, b)
      and not exists (select 1 from public.library_block_hides h where h.tenant_id = t and h.block_id = b.id))
$$;
revoke all on function private.library_block_usable(uuid, uuid) from public, anon, authenticated, service_role;

-- The blocks one workspace may use (the planner and the library screen,
-- service role): every visible block, no cap, hidden ones only when asked
-- (the screen shows them with "Use it again"), each shared one with the
-- emails it may use that used it, for the app's Observer check. No blueprint.
create or replace function public.library_blocks_for(t uuid, with_hidden boolean default false)
returns table (id uuid, tenant_id uuid, kind text, facts jsonb, uses integer, brands integer, email_types text[],
  width numeric, hidden boolean, emails jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.blocks_job_role();
  return query
    select b.id, b.tenant_id, b.kind, b.facts, b.uses, b.brands, b.email_types,
      coalesce((b.blueprint->>'width')::numeric, 0),
      exists (select 1 from public.library_block_hides h where h.tenant_id = t and h.block_id = b.id),
      private.library_block_emails(t, b)
    from public.library_blocks b
    where (b.tenant_id is null or b.tenant_id = t) and private.library_block_visible(t, b)
      and (with_hidden or not exists (select 1 from public.library_block_hides h where h.tenant_id = t and h.block_id = b.id))
    order by b.brands desc, b.uses desc, b.id;
end $$;
revoke all on function public.library_blocks_for(uuid, boolean) from public, anon, authenticated;
grant execute on function public.library_blocks_for(uuid, boolean) to service_role;

-- The copy job's check when it hands a Scratch copy out (reference time):
-- which of the given blocks the workspace may still use, with where each
-- one's geometry came from (for the leak check and the Observer check).
create or replace function public.library_blocks_check(t uuid, blocks uuid[])
returns table (id uuid, tenant_id uuid, geometry_message uuid, geometry_upload uuid, emails jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.blocks_job_role();
  if blocks is null or cardinality(blocks) > 12 then
    raise exception 'Invalid blocks' using errcode = '22023';
  end if;
  return query
    select b.id, b.tenant_id, b.geometry_message, b.geometry_upload, private.library_block_emails(t, b)
    from public.library_blocks b
    where b.id = any(blocks) and private.library_block_usable(t, b.id);
end $$;
revoke all on function public.library_blocks_check(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.library_blocks_check(uuid, uuid[]) to service_role;

-- "Don't use this layout" (and "Use it again"): the owner or an admin of
-- an active workspace, a block the workspace can see. Returns the new state.
create or replace function public.set_library_block_hidden(t uuid, block uuid, hide boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_upload_manager(t);
  if hide is null or not exists (select 1 from public.library_blocks b
      where b.id = block and private.library_block_visible(t, b)) then
    raise exception 'Not a layout you can use' using errcode = '22023', hint = 'block_unknown';
  end if;
  if hide then
    insert into public.library_block_hides(tenant_id, block_id, hidden_by)
      values (t, block, auth.uid()) on conflict do nothing;
  else
    delete from public.library_block_hides where tenant_id = t and block_id = block;
  end if;
  return hide;
end $$;
revoke all on function public.set_library_block_hidden(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_library_block_hidden(uuid, uuid, boolean) to authenticated;

drop function public.request_email_copy(uuid, uuid, uuid, jsonb, integer, uuid);

create or replace function public.request_email_copy(build uuid, lease uuid, message uuid, input jsonb,
  photos integer default 0, upload uuid default null, blocks uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.email_builds; c public.email_copies; t uuid; x uuid;
begin
  perform private.copy_job_role();
  -- Tenant first, then the build (as every build-leased command).
  select e.tenant_id into t from public.email_builds e where e.id = build;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for share;
  b := private.leased_email_build(build, lease, 'build_queued');
  if b.step is distinct from 'design' then
    raise exception 'Only the design step copies an email' using errcode = 'PT409', detail = 'not_design_step';
  end if;
  -- A build that copies an upload asks only for that upload's copy (an
  -- inspiration email, another upload or blocks are refused).
  if b.upload_id is not null and upload is distinct from b.upload_id then
    raise exception 'This build copies one of your own emails' using errcode = 'PT409', detail = 'upload_mismatch';
  end if;
  -- DES-ENGINE-004b: only a Scratch build is drawn from library blocks.
  if blocks is not null and (b.mode <> 'scratch' or b.reference_id is not null or b.upload_id is not null) then
    raise exception 'Only a Scratch email is built from the library' using errcode = 'PT409', detail = 'not_scratch';
  end if;
  select * into c from public.email_copies where build_id = build;
  if not found then
    if num_nonnulls(message, upload, blocks) <> 1 or input is null or jsonb_typeof(input) <> 'object'
       or octet_length(input::text) > 300000 then
      raise exception 'Invalid copy input' using errcode = '22023';
    end if;
    if photos is null or photos not between 0 and 24 then
      raise exception 'Invalid copy input' using errcode = '22023';
    end if;
    if message is not null and not exists (select 1 from public.inbox_blueprints p where p.inbox_message_id = message and p.version = 1
                   and p.state = 'ready') then
      raise exception 'The inspiration email has no blueprint' using errcode = 'PT409', detail = 'no_blueprint';
    end if;
    -- DES-ENGINE-003b: the build's own upload, of its own workspace, ready.
    if upload is not null and (b.upload_id is distinct from upload or not exists (
        select 1 from public.email_uploads u where u.id = upload and u.tenant_id = b.tenant_id and u.state = 'ready')) then
      raise exception 'The email of yours has no blueprint' using errcode = 'PT409', detail = 'no_blueprint';
    end if;
    -- DES-ENGINE-004b: 1 to 12 blocks, each once, each one the workspace may use.
    if blocks is not null then
      if cardinality(blocks) not between 1 and 12 or array_position(blocks, null) is not null
         or (select count(distinct v) from unnest(blocks) v) <> cardinality(blocks) then
        raise exception 'Invalid copy input' using errcode = '22023';
      end if;
      foreach x in array blocks loop
        if not private.library_block_usable(b.tenant_id, x) then
          raise exception 'A library layout cannot be used' using errcode = 'PT409', detail = 'no_blueprint';
        end if;
      end loop;
    end if;
    insert into public.email_copies(build_id, tenant_id, inbox_message_id, upload_id, blocks, input, photos)
      values (build, b.tenant_id, message, upload, blocks, input, photos)
      returning * into c;
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('design.copy', build::text, 'design.copy:' || build)
      on conflict do nothing;
  elsif c.inbox_message_id is distinct from message or c.upload_id is distinct from upload
        or c.blocks is distinct from blocks then
    raise exception 'This build copies another email' using errcode = 'PT409', detail = 'other_email';
  end if;
  return jsonb_build_object('state', c.state, 'result', c.result, 'failure', c.failure, 'photos', c.photos);
end $$;
revoke all on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer, uuid, uuid[]) to service_role;

-- A copy job whose kind's switch is off (a Copy or upload copy with
-- DESIGN_LIBRARY_COPY off, a Scratch copy with DESIGN_LIBRARY_SCRATCH off)
-- is parked for an hour, its try given back, with an honest code; the app
-- never counts it as waiting while its switch is off, so it never wakes the
-- runner on its own.
create or replace function public.park_email_copy(job uuid, lease uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  perform private.copy_job_role();
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.copy' then raise exception 'Not a copy job' using errcode = '23514'; end if;
  update public.platform_jobs
    set status = 'retry_wait', lease_token = null, lease_expires_at = null,
        attempt = greatest(0, j.attempt - 1), last_error_code = 'switch_off',
        available_at = now() + interval '1 hour', updated_at = now()
    where id = j.id;
end $$;
revoke all on function public.park_email_copy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.park_email_copy(uuid, uuid) to service_role;
