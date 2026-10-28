create table public.verified_render_uploads (
 storage_path text primary key,tenant_id uuid not null references public.tenants(id),job_id uuid not null references public.job_runs(id),
 section text not null check(section in ('hero','copy','cta')),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),byte_size integer not null check(byte_size between 1 and 2097152),created_at timestamptz not null default now()
);
create table public.design_renders (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,campaign_id uuid not null,revision integer not null,copy_revision integer not null,
 strips jsonb not null check(jsonb_typeof(strips)='array'),input_revisions jsonb not null,source text not null check(source in ('fixture_structure','own_template','reference_structure')),source_id uuid,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(campaign_id,revision),foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id)
);
create table public.render_reviews (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),render_id uuid not null references public.design_renders(id),
 decision text not null check(decision in ('revision','approved')),section text not null check(section in ('hero','copy','cta','whole_design')),feedback text not null check(length(feedback)<=5000),actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
do $$declare tab text;begin foreach tab in array array['verified_render_uploads','design_renders','render_reviews'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',tab);
 execute format('grant select on public.%I to authenticated',tab);
end loop;end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('email-artifacts','email-artifacts',false,2097152,array['image/svg+xml']) on conflict(id) do nothing;
create or replace function private.can_read_render_object(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.verified_render_uploads u where u.storage_path=object_name and private.is_active_member(u.tenant_id));
$$;
revoke all on function private.can_read_render_object(text) from public,anon;
grant execute on function private.can_read_render_object(text) to authenticated;
create policy private_render_read on storage.objects for select to authenticated using(bucket_id='email-artifacts' and private.can_read_render_object(name));
