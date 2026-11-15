-- REL-084 (owner pick 84): never fail silently. Each time an agent or a
-- check gave up and the job took a safer choice (D16), the fallback log
-- keeps one plain line: what went wrong and what was done instead, in
-- fixed words per rule or code (never the email's copy, codes or
-- products). Until now only platform admins read it; the workspace's own
-- active members now read their workspace's lines too, so the owner can
-- see what the team changed and why. Platform-wide lines (no workspace)
-- stay admin-only, and only jobs write, through record_fallback.
-- The number is chosen at merge time (D24).

create policy member_read on public.agent_fallbacks for select to authenticated
  using (tenant_id is not null and private.is_active_member(tenant_id));
