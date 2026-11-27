-- DES-ENGINE-003b review (#680): a build that copies one of the
-- workspace's own uploads asks only for that upload's copy: a request for
-- an inspiration email, or for another upload, is refused (PT409, detail
-- `upload_mismatch`), whether or not its copy was asked for before.
-- Otherwise as in 090104. The number is chosen at merge time (D24).

create or replace function public.request_email_copy(build uuid, lease uuid, message uuid, input jsonb,
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
  -- A build that copies an upload asks only for that upload's copy (an
  -- inspiration email, or another upload, is refused).
  if b.upload_id is not null and upload is distinct from b.upload_id then
    raise exception 'This build copies one of your own emails' using errcode = 'PT409', detail = 'upload_mismatch';
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
