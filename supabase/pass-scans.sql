-- +5 receipt scans with an Event Pass (2026-11-27). Safe to run more than once.
--
-- An event with a pass has 5 receipt scans (that read a receipt; 12 tries)
-- shared by everyone in it, used only once a person's own monthly scans are
-- gone. Plus and Pro work as before. The scan says which event it's for;
-- without one (older app builds) nothing changes.

alter table public.receipt_scans add column if not exists event_id uuid
  references public.events (id) on delete set null;
alter table public.receipt_scans add column if not exists from_pass boolean not null default false;
create index if not exists receipt_scans_event_pass_idx on public.receipt_scans (event_id) where from_pass;

-- The event's pass scans left, for someone in it (0 without a pass).
create or replace function private.pass_scans_left(eid uuid, uid uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when eid is null or uid is null or not private.is_member(eid, uid)
      or not exists (select 1 from public.event_passes p where p.event_id = eid) then 0
    else greatest(0, least(
      5 - (select count(*) from public.receipt_scans s where s.event_id = eid and s.from_pass and s.succeeded),
      12 - (select count(*) from public.receipt_scans s where s.event_id = eid and s.from_pass)
    ))::integer
  end;
$$;
revoke execute on function private.pass_scans_left(uuid, uuid) from public, anon, authenticated;

-- Scans left: your own this month plus the event's pass scans. Null: no limit.
drop function if exists public.receipt_scans_left();
create or replace function public.receipt_scans_left(p_event uuid default null)
returns integer
language sql stable security definer set search_path = '' as $$
  with lim as (
    select case private.effective_plan(auth.uid())
             when 'free' then 1 when 'plus' then 15 end as ok,
           case private.effective_plan(auth.uid())
             when 'free' then 4 when 'plus' then 40 end as tries
  )
  select case
    when lim.ok is null then null
    else (
      select greatest(0, least(lim.ok - count(*) filter (where s.succeeded), lim.tries - count(*)))::integer
        from public.receipt_scans s
       where s.user_id = auth.uid()
         and not s.from_pass
         and s.scanned_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    ) + private.pass_scans_left(p_event, auth.uid())
  end
  from lim;
$$;
revoke execute on function public.receipt_scans_left(uuid) from public, anon;
grant execute on function public.receipt_scans_left(uuid) to authenticated;

-- Take one scan: your own first, then the event's pass scans.
drop function if exists public.claim_receipt_scan();
create or replace function public.claim_receipt_scan(p_event uuid default null)
returns table (allowed boolean, scan_id bigint, scans_left integer)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  total integer;
  pass_left integer;
  new_id bigint;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('receipt_scan:' || me::text, 0));
  if p_event is not null then
    perform pg_advisory_xact_lock(hashtextextended('receipt_scan_event:' || p_event::text, 0));
  end if;

  total := public.receipt_scans_left(p_event);
  if total is null then
    return query select true, null::bigint, null::integer;
    return;
  end if;
  if total <= 0 then
    return query select false, null::bigint, 0;
    return;
  end if;

  pass_left := private.pass_scans_left(p_event, me);
  -- Own scans are used up when everything left is the pass's.
  insert into public.receipt_scans (user_id, event_id, from_pass)
  values (me, p_event, total <= pass_left)
  returning id into new_id;
  return query select true, new_id, total - 1;
end;
$$;
revoke execute on function public.claim_receipt_scan(uuid) from public, anon;
grant execute on function public.claim_receipt_scan(uuid) to authenticated;
