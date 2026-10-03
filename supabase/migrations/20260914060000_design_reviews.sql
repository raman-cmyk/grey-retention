create table public.designer_assignments (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null, campaign_id uuid not null,designer_id uuid not null references public.designers(id),
 copy_revision integer not null,brief jsonb not null, state text not null default 'assigned' check(state in ('assigned','submitted','revisions_requested','approved','cancelled')),
 due_at timestamptz not null,assigned_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id),unique(tenant_id,id)
);
create unique index one_active_design_assignment on public.designer_assignments(campaign_id) where state<>'cancelled';
create table public.verified_design_uploads (
 storage_path text primary key,tenant_id uuid not null,assignment_id uuid not null,uploaded_by uuid not null references public.profiles(id),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),media_type text not null check(media_type in ('image/png','image/jpeg','image/webp')),
 byte_size integer not null check(byte_size between 1 and 10485760),created_at timestamptz not null default now(),
 foreign key(tenant_id,assignment_id) references public.designer_assignments(tenant_id,id)
);
create table public.designer_submissions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,assignment_id uuid not null,revision integer not null,copy_revision integer not null,
 storage_path text not null unique references public.verified_design_uploads(storage_path),notes text not null check(char_length(notes)<=5000),
 submitted_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(tenant_id,assignment_id) references public.designer_assignments(tenant_id,id),unique(assignment_id,revision)
);
create table public.designer_reviews (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,assignment_id uuid not null,submission_id uuid not null references public.designer_submissions(id),
 decision text not null check(decision in ('revision','approved')),section text not null check(char_length(section) between 1 and 200),feedback text not null check(char_length(feedback)<=5000),
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),foreign key(tenant_id,assignment_id) references public.designer_assignments(tenant_id,id)
);
create or replace function private.assigned_designer(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.designer_assignments x where x.id=a and x.designer_id=private.current_designer_id() and x.state<>'cancelled' and private.designer_has_tenant_access(x.tenant_id));
$$;
revoke all on function private.assigned_designer(uuid) from public,anon;
grant execute on function private.assigned_designer(uuid) to authenticated;
do $$ declare t text; begin
 foreach t in array array['designer_assignments','verified_design_uploads','designer_submissions','designer_reviews'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy scoped_read on public.%I for select to authenticated using(private.is_active_member(tenant_id) or private.assigned_designer(%s))',t,case when t='designer_assignments' then 'id' else 'assignment_id' end);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create index %I on public.%I(tenant_id,created_at)',t||'_tenant_idx',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('designer-submissions','designer-submissions',false,10485760,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create or replace function private.can_read_design_object(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.designer_assignments a where a.id::text=split_part(object_name,'/',2) and a.tenant_id::text=split_part(object_name,'/',1) and (private.is_active_member(a.tenant_id) or private.assigned_designer(a.id)));
$$;
revoke all on function private.can_read_design_object(text) from public,anon;
grant execute on function private.can_read_design_object(text) to authenticated;
create policy scoped_design_download on storage.objects for select to authenticated using(bucket_id='designer-submissions' and private.can_read_design_object(name));
-- Uploads go through the authenticated, signature-validating server boundary only.
