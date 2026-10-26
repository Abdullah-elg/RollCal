-- ============================================================================
-- RollCal - "Seen by" in event chat
-- Run after private-schema.sql. Safe to re-run.
--
-- One row per person per event chat: when they last read it. The chat shows
-- "Seen by" under the newest message with everyone whose read time is at or
-- after it.
--   * Members of the event can see the event's read times; nobody else can.
--   * People only ever set their own, through mark_chat_read, which uses the
--     server's clock so a read time can't be made up.
--   * Rows go when the event or the person is deleted.
-- ============================================================================

create table if not exists public.chat_reads (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.chat_reads enable row level security;

drop policy if exists "chat_reads_select_member" on public.chat_reads;
create policy "chat_reads_select_member" on public.chat_reads
  for select to authenticated
  using (private.is_member(event_id, (select auth.uid())));

-- No insert, update or delete policies: writes only go through the function.
revoke insert, update, delete on public.chat_reads from anon, authenticated;
grant select on public.chat_reads to authenticated;

-- Marks the chat read up to now for the signed-in person. Does nothing for
-- someone who isn't a member. Never moves a read time backwards.
create or replace function public.mark_chat_read(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not private.is_member(p_event, me) then
    return;
  end if;
  insert into chat_reads (event_id, user_id, last_read_at)
  values (p_event, me, now())
  on conflict (event_id, user_id)
    do update set last_read_at = greatest(chat_reads.last_read_at, excluded.last_read_at);
end;
$$;

revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Live updates, so "Seen by" fills in while the chat is open. Realtime
-- applies the select policy above, so only members receive them.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reads'
  ) then
    alter publication supabase_realtime add table public.chat_reads;
  end if;
end $$;
