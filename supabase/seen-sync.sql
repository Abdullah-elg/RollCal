-- ============================================================================
-- RollCal - "Seen" that follows you between phones
-- Run after event-delete.sql. Safe to re-run.
--
-- What you've seen used to live only on the phone, so a second phone (or a
-- reinstall) showed everything as new again. These marks now live here too:
--   * inbox:<item>    - when you first saw a notification (lib/inbox);
--   * photos:<event>  - how far you've looked through an event's photos
--                        (lib/unread).
-- Chat reads already live on the server (chat-reads.sql); the app now uses
-- those for its unread dots as well.
--
-- Each person sees and writes only their own marks. A mark never moves
-- backwards, and inbox marks are cleared after 30 days.
-- ============================================================================

create table if not exists public.seen_marks (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  seen_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.seen_marks enable row level security;

drop policy if exists "seen_marks_own" on public.seen_marks;
create policy "seen_marks_own" on public.seen_marks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.seen_marks from anon;
grant select, insert, update, delete on public.seen_marks to authenticated;

-- Never backwards, never moved to another person or key; and a cap so one
-- account can't fill the table.
create or replace function private.seen_marks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.key := old.key;
    new.seen_at := greatest(old.seen_at, new.seen_at);
  elsif (select count(*) from seen_marks where user_id = new.user_id) >= 5000 then
    raise exception 'Too many seen marks' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.seen_marks_guard() from public, anon, authenticated;

drop trigger if exists seen_marks_guard on public.seen_marks;
create trigger seen_marks_guard
  before insert or update on public.seen_marks
  for each row execute function private.seen_marks_guard();

select cron.unschedule('seen-marks-prune')
 where exists (select 1 from cron.job where jobname = 'seen-marks-prune');

select cron.schedule(
  'seen-marks-prune',
  '23 4 * * *',
  $job$
    delete from public.seen_marks
     where key like 'inbox:%' and seen_at < now() - interval '30 days';
  $job$
);
