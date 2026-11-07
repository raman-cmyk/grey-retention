-- RET-001 (decision D3, docs/BUILD_BRIEF.md): there is no human designer.
-- The AI builds every email, and the automatic render path makes the design
-- the owner approves. enqueue_render refuses while a human assignment is
-- open, so close every open assignment and return its campaign to "design
-- not started", exactly as an owner rejection does (planning commands).
--
-- Not destructive: no table, column or row is dropped. Approved and
-- already-cancelled assignments, their submissions and reviews stay as
-- history. Running it again changes nothing.
create or replace function private.retire_open_designer_assignments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed_count integer;
begin
  with closed as (
    update public.designer_assignments
    set state = 'cancelled', updated_at = now()
    where state in ('assigned', 'submitted', 'revisions_requested')
    returning campaign_id
  ),
  reopened as (
    update public.campaigns c
    set design_revision = c.design_revision + 1,
      design_state = 'unassigned',
      delivery_revision = c.delivery_revision + 1,
      delivery_state = 'not_ready',
      updated_at = now()
    where c.id in (select campaign_id from closed)
      -- An open human assignment means the design was never approved, so
      -- no delivery can be active; the guard keeps a provider send safe.
      and c.design_state in ('assigned', 'submitted', 'revisions_requested')
      and c.delivery_state in ('not_ready', 'ready', 'failed', 'cancelled')
    returning c.id
  )
  select count(*) into closed_count from closed;
  return closed_count;
end
$$;

revoke all on function private.retire_open_designer_assignments()
from public, anon, authenticated;

select private.retire_open_designer_assignments();
