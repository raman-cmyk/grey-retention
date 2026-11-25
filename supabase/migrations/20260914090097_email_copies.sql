-- DES-ENGINE-002b2 (step 2 of the email design plan, owner decisions of 25
-- Nov): "Use this design" with Copy copies the chosen inspiration email 1:1
-- in structure for the brand. The copy needs a browser (photos cut, the
-- email drawn, measured and checked), so the build's design step asks for
-- it and waits, like the design studio's pictures (DST-006b), and the
-- inbox browser job makes it.
--
-- * email_copies: one per build (its design step), written only through
--   its commands. `input` is what the copy needs (the brand, its products,
--   its words and rules, the inspiration email); `result` the drawn email
--   (cut photos as placeholders until the app signs their links), each
--   section's outcome and why, and the leak check. A workspace never reads
--   the table: the email's page reads the built email, which keeps the
--   reasons in plain words.
-- * Job kind `design.copy`, leased like every platform job (2-minute lease,
--   4 tries). Its cut photos go to the private bucket `email-copies`
--   (`copy/<build>/<n>.jpg`, JPEG, at most 3 MiB), through signed upload
--   links only; the push imports them into Klaviyo (rule 11).
-- * Recording a copy brings the build's design step forward (`not_before`
--   now), so the next claim (the owner's click or the sweep) goes on.
-- * The number is chosen at merge time (D24).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('email-copies', 'email-copies', false, 3145728, array['image/jpeg'])
  on conflict (id) do nothing;

create table public.email_copies (
  build_id uuid primary key references public.email_builds(id),
  tenant_id uuid not null references public.tenants(id),
  inbox_message_id uuid not null references public.inbox_messages(id),
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  input jsonb not null check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 300000),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 400000)),
  failure text check (failure ~ '^[a-z0-9_]{1,60}$'),
  photos integer not null default 0 check (photos between 0 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'done') = (result is not null)),
  check ((state = 'failed') = (failure is not null))
);
alter table public.email_copies enable row level security;
create policy operator_read on public.email_copies for select to authenticated using (private.is_operator());
revoke all on public.email_copies from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.email_copies from authenticated, service_role;
grant select on public.email_copies to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_copies from public, anon, authenticated, service_role';
  end if;
end $$;

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant',
                    'studio.render','studio.preview','inbox.blueprint','design.copy'));

-- The design step asks for its copy (under its live lease). The first ask
-- stores the input and queues the job; later asks only read the state.
-- Returns {state, result, failure}.
create or replace function public.request_email_copy(build uuid, lease uuid, message uuid, input jsonb,
  photos integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.email_builds; c public.email_copies;
begin
  b := private.leased_email_build(build, lease, 'build_queued');
  if b.step is distinct from 'design' then
    raise exception 'Only the design step copies an email' using errcode = 'PT409', detail = 'not_design_step';
  end if;
  select * into c from public.email_copies where build_id = build;
  if not found then
    if input is null or jsonb_typeof(input) <> 'object' or octet_length(input::text) > 300000 then
      raise exception 'Invalid copy input' using errcode = '22023';
    end if;
    if photos is null or photos not between 0 and 24 then
      raise exception 'Invalid copy input' using errcode = '22023';
    end if;
    if not exists (select 1 from public.inbox_blueprints p where p.inbox_message_id = message and p.version = 1
                   and p.state = 'ready') then
      raise exception 'The inspiration email has no blueprint' using errcode = 'PT409', detail = 'no_blueprint';
    end if;
    insert into public.email_copies(build_id, tenant_id, inbox_message_id, input, photos)
      values (build, b.tenant_id, message, input, photos)
      returning * into c;
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('design.copy', build::text, 'design.copy:' || build)
      on conflict do nothing;
  end if;
  return jsonb_build_object('state', c.state, 'result', c.result, 'failure', c.failure);
end $$;
revoke all on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer) to service_role;

-- The browser job's result: the copy, or a reason it could not be made.
-- Once per build. Finishes the job and brings the design step forward.
create or replace function public.record_email_copy(job uuid, lease uuid, result jsonb default null,
  failure text default null)
returns text language plpgsql security definer set search_path='' as $$
declare j public.platform_jobs; build uuid;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.copy' then raise exception 'Not a copy job' using errcode = '23514'; end if;
  build := j.subject_key::uuid;
  if (result is null) = (failure is null) then
    raise exception 'Give a result or a failure' using errcode = '23514';
  end if;
  if failure is not null and failure !~ '^[a-z0-9_]{1,60}$' then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  if result is not null and (jsonb_typeof(result) <> 'object' or octet_length(result::text) > 400000
     or jsonb_typeof(result->'html') is distinct from 'string' or jsonb_typeof(result->'sections') is distinct from 'array') then
    raise exception 'Invalid copy' using errcode = '23514';
  end if;
  update public.email_copies
    set state = case when result is null then 'failed' else 'done' end,
        result = record_email_copy.result, failure = record_email_copy.failure, updated_at = now()
    where build_id = build and state = 'queued';
  update public.platform_jobs
    set status = 'succeeded', lease_token = null, lease_expires_at = null,
        result = jsonb_build_object('state', case when result is null then 'failed' else 'done' end),
        finished_at = now(), updated_at = now()
    where id = j.id;
  -- The waiting design step goes on at the next claim.
  update public.email_builds set not_before = now(), updated_at = now()
    where id = build and state = 'build_queued' and step = 'design' and not_before > now();
  return (select c.state from public.email_copies c where c.build_id = build);
end $$;
revoke all on function public.record_email_copy(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_email_copy(uuid, uuid, jsonb, text) to service_role;

-- A job that failed four times leaves its copy failed (the design step then
-- draws coded blocks and says why).
create or replace function private.fail_email_copy()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind = 'design.copy' and new.status = 'failed' and old.status is distinct from 'failed' then
    update public.email_copies set state = 'failed', failure = 'copy_job_failed', updated_at = now()
      where build_id = new.subject_key::uuid and state = 'queued';
    update public.email_builds set not_before = now(), updated_at = now()
      where id = new.subject_key::uuid and state = 'build_queued' and step = 'design' and not_before > now();
  end if;
  return null;
end $$;
revoke all on function private.fail_email_copy() from public, anon, authenticated;
create trigger fail_email_copy after update of status on public.platform_jobs
  for each row when (new.kind = 'design.copy' and new.status = 'failed')
  execute function private.fail_email_copy();
