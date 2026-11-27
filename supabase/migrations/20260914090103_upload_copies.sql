-- DES-ENGINE-003b (step 3 of the email design plan, "Upload 1:1", part b):
-- Create email copies an email the owner uploaded ("Add your own email").
-- His brand's own design keeps its look and gets the planned email's new
-- content; another brand's email is copied like a library email (rule 8).
--
-- * email_builds.upload_id: the upload the owner chose (`email_uploads.id`
--   of the build's own workspace), with Copy only, never with an
--   inspiration email. A plain id, no foreign key: an upload the owner
--   deletes leaves its builds as they are (their copies are made already,
--   or the build draws coded blocks and says why).
-- * create_email_build takes it as an optional last argument (default
--   null): every call before keeps its checks and answers. An unknown,
--   unready or other workspace's upload is refused the same way (hint
--   `build_upload_unknown`), under the workspace lock.
-- * email_copies.upload_id: the copy of an upload (`inbox_message_id` then
--   null); exactly one of the two. request_email_copy takes it as an
--   optional last argument: only the build's own upload, ready, in its
--   own workspace.
-- * The number is chosen at merge time (D24).

alter table public.email_builds
  add column upload_id uuid,
  add constraint email_builds_upload_mode
    check (upload_id is null or (mode = 'copy' and reference_id is null));

alter table public.email_copies
  alter column inbox_message_id drop not null,
  add column upload_id uuid,
  add constraint email_copies_one_source check ((inbox_message_id is null) <> (upload_id is null));

drop function public.create_email_build(uuid, uuid, integer, text, uuid);

-- The owner's "Create email" on a planned email (D17). As in 090094, and
-- (DES-ENGINE-003b) from one of the workspace's own uploads when given.
create function public.create_email_build(t uuid, run uuid, slot integer,
  mode text default 'scratch', reference uuid default null, upload uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
  zone text;
  day date;
  build uuid;
  key uuid;
begin
  -- require_member locks the workspace row (tenant first), then the run.
  perform private.require_member(t, true);
  if mode is null or mode not in ('copy', 'remix', 'scratch') then
    raise exception 'Choose Copy, Remix or Scratch' using errcode = '22023', hint = 'build_mode_unknown';
  end if;
  if create_email_build.reference is not null and mode = 'scratch' then
    raise exception 'Choose Copy or Remix for an inspiration email' using errcode = '22023', hint = 'build_mode_reference';
  end if;
  -- DES-ENGINE-003b: an upload of this workspace, read and ready, copied only.
  if create_email_build.upload is not null and create_email_build.reference is not null then
    raise exception 'Choose an inspiration email or one of your own' using errcode = '22023', hint = 'build_upload_reference';
  end if;
  if create_email_build.upload is not null and mode <> 'copy' then
    raise exception 'Your own emails are copied' using errcode = '22023', hint = 'build_mode_upload';
  end if;
  if create_email_build.upload is not null and not exists (
    select 1 from public.email_uploads u
    where u.id = create_email_build.upload and u.tenant_id = t and u.state = 'ready'
  ) then
    raise exception 'This email of yours is not one you can use' using errcode = '22023', hint = 'build_upload_unknown';
  end if;
  -- Under the workspace lock: following and hiding a brand take it too.
  if create_email_build.reference is not null and not exists (
    select 1 from public.competitor_emails e
      join public.competitor_subscriptions s
        on s.capture_id = e.capture_id and s.tenant_id = t and s.active
    where e.id = create_email_build.reference
      and not exists (select 1 from public.competitor_hidden h
                      where h.tenant_id = t and h.capture_id = e.capture_id)
  ) then
    raise exception 'This inspiration email is not one you can use' using errcode = '22023', hint = 'build_reference_unknown';
  end if;
  select * into r from public.strategy_runs s where s.id = run and s.tenant_id = t for update;
  if not found then raise exception 'Plan unavailable' using errcode = '42501'; end if;
  if r.state <> 'planned' then
    raise exception 'This plan is not ready yet' using errcode = 'PT409';
  end if;
  -- Only the latest plan: an older one (an old tab) has been replaced.
  if exists (select 1 from public.strategy_runs s
             where s.tenant_id = t and s.created_at > r.created_at) then
    raise exception 'This plan has been replaced; use the latest plan' using errcode = 'PT409';
  end if;
  if slot is null or slot < 0 or slot >= jsonb_array_length(coalesce(r.plan->'slots', '[]'::jsonb)) then
    raise exception 'This plan has no such email' using errcode = '22023';
  end if;
  if mode <> 'scratch' and r.plan->'slots'->slot->>'format' = 'text' then
    raise exception 'A text email is written, not copied or remixed' using errcode = '22023', hint = 'build_mode_text';
  end if;
  select timezone into zone from public.tenants where id = t;
  begin
    day := (r.plan->'slots'->slot->>'date')::date;
  exception when others then
    raise exception 'This planned email has no day' using errcode = '22023';
  end;
  if day is null then
    raise exception 'This planned email has no day' using errcode = '22023';
  end if;
  if day < (now() at time zone coalesce(zone, 'UTC'))::date then
    raise exception 'This email''s day has passed' using errcode = 'PT409';
  end if;
  select b.id into build from public.email_builds b
    where b.run_id = run and b.slot = create_email_build.slot
      and b.state in ('build_queued', 'push_queued', 'drafted');
  if found then return build; end if;
  if (select count(*) from public.email_builds b
      where b.run_id = run and b.slot = create_email_build.slot and b.state = 'failed') >= 5 then
    raise exception 'This email failed 5 times; plan again' using errcode = 'PT409';
  end if;
  -- A failed build that reached the push may have made a draft already:
  -- its key is kept, so a new push returns (and updates) that draft.
  select b.push_key into key from public.email_builds b
    where b.run_id = run and b.slot = create_email_build.slot
      and b.state = 'failed' and b.email is not null
    order by b.created_at desc limit 1;
  insert into public.email_builds (tenant_id, run_id, slot, push_key, created_by, mode, reference_id, upload_id)
    values (t, run, create_email_build.slot, coalesce(key, gen_random_uuid()), auth.uid(),
      create_email_build.mode, create_email_build.reference, create_email_build.upload)
    returning id into build;
  return build;
end $$;

revoke all on function public.create_email_build(uuid, uuid, integer, text, uuid, uuid) from public, anon;
grant execute on function public.create_email_build(uuid, uuid, integer, text, uuid, uuid) to authenticated;

drop function public.request_email_copy(uuid, uuid, uuid, jsonb, integer);

-- The design step asks for its copy (under its live lease). As in 090097,
-- and (DES-ENGINE-003b) for the build's own upload instead of an
-- inspiration email.
create function public.request_email_copy(build uuid, lease uuid, message uuid, input jsonb,
  photos integer default 0, upload uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.email_builds; c public.email_copies; t uuid;
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
  select * into c from public.email_copies where build_id = build;
  if not found then
    if (message is null) = (upload is null) or input is null or jsonb_typeof(input) <> 'object' or octet_length(input::text) > 300000 then
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
    insert into public.email_copies(build_id, tenant_id, inbox_message_id, upload_id, input, photos)
      values (build, b.tenant_id, message, upload, input, photos)
      returning * into c;
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('design.copy', build::text, 'design.copy:' || build)
      on conflict do nothing;
  elsif c.inbox_message_id is distinct from message or c.upload_id is distinct from upload then
    raise exception 'This build copies another email' using errcode = 'PT409', detail = 'other_email';
  end if;
  return jsonb_build_object('state', c.state, 'result', c.result, 'failure', c.failure, 'photos', c.photos);
end $$;
revoke all on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer, uuid) from public, anon, authenticated;
grant execute on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer, uuid) to service_role;
