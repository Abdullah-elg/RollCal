-- Bill splitting on or off, per event. The host sets it when creating the
-- event or later in Manage event. Off stops new bills; bills that already
-- exist stay readable and payable. Run after bills.sql. Safe to re-run.

alter table public.events add column if not exists bills_enabled boolean not null default true;

-- Whether new bills are allowed in this event. Runs as the owner so the
-- check doesn't depend on what the person can read.
create or replace function private.bills_on(eid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select e.bills_enabled from public.events e where e.id = eid), false);
$$;

revoke execute on function private.bills_on(uuid) from public, anon;
grant execute on function private.bills_on(uuid) to authenticated, service_role;

-- Only takes access away: the existing rule (a member, as a draft) still
-- applies on top.
drop policy if exists "bills_insert_enabled" on public.bills;
create policy "bills_insert_enabled" on public.bills
  as restrictive for insert to authenticated
  with check (private.bills_on(event_id));
