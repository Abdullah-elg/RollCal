-- ============================================================================
-- RollCal - Block, report and Quiet mode
-- Run after security.sql (it replaces two friendship and invitation policies
-- from policies.sql, so re-run this after policies.sql). Safe to re-run.
--
-- Block (everyone): the two people can't friend each other or be invited by
-- each other, an existing friendship ends, and the app hides the blocked
-- person's messages, photos and profile from the person who blocked them.
-- Nobody is told they've been blocked.
--
-- Report (everyone): a person, message, photo or event. Reports land in the
-- reports table for you to review in the dashboard; Apple expects action on
-- them within 24 hours.
--
-- Quiet mode (Pro): friend requests to you are kept but hidden. If you send
-- a request to someone who already asked you, you become friends straight
-- away, so people in Quiet mode can still add each other.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCKS
-- ----------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_id_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- You see, add and remove only your own blocks. Who has blocked you stays
-- private.
drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own" on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own" on public.blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own" on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- Whether either of two people has blocked the other.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
     where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- Everyone the signed-in user shouldn't see in search: people they blocked
-- and people who blocked them, without saying which.
create or replace function public.hidden_people()
returns setof uuid language sql stable security definer set search_path = public as $$
  select blocked_id from blocks where blocker_id = auth.uid()
  union
  select blocker_id from blocks where blocked_id = auth.uid();
$$;

revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
revoke execute on function public.hidden_people() from public, anon;
grant execute on function public.hidden_people() to authenticated;

-- Blocking someone ends any friendship or request between you.
create or replace function public.blocks_end_friendship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from friendships
   where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
      or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return new;
end;
$$;

revoke execute on function public.blocks_end_friendship() from public, anon, authenticated;

drop trigger if exists blocks_end_friendship on public.blocks;
create trigger blocks_end_friendship
  after insert on public.blocks
  for each row execute function public.blocks_end_friendship();

-- No friend requests or invitations between people who've blocked each other.
drop policy if exists "friendships_insert_request" on public.friendships;
create policy "friendships_insert_request" on public.friendships
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and addressee_id <> (select auth.uid())
    and status = 'pending'
    and not public.is_blocked_between(requester_id, addressee_id)
  );

drop policy if exists "invitations_insert_leader" on public.invitations;
create policy "invitations_insert_leader" on public.invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and public.is_leader(event_id, (select auth.uid()))
    and not public.is_banned(event_id, invited_user_id)
    and not public.is_blocked_between(invited_by, invited_user_id)
    and status = 'pending'
  );


-- ----------------------------------------------------------------------------
-- QUIET MODE
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists quiet_mode boolean not null default false;

-- Only counts while the person has Pro; turning it off or losing Pro brings
-- hidden requests back.
create or replace function public.is_quiet(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select quiet_mode and is_pro from profiles where id = uid), false);
$$;

revoke execute on function public.is_quiet(uuid) from public, anon;
grant execute on function public.is_quiet(uuid) to authenticated;

-- Pending requests addressed to someone in Quiet mode are hidden from them
-- (so no list, badge or notification). The sender still sees theirs.
drop policy if exists "friendships_select_involved" on public.friendships;
create policy "friendships_select_involved" on public.friendships
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or (
      addressee_id = (select auth.uid())
      and (status = 'accepted' or not public.is_quiet((select auth.uid())))
    )
  );

-- Sending a request. If the other person already asked you, this accepts
-- theirs instead, which is how two people in Quiet mode add each other.
-- Returns 'requested', 'friends' (accepted now or already), or 'unavailable'
-- (blocked either way; deliberately the same answer for both).
create or replace function public.request_friend(other uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  existing friendships%rowtype;
begin
  if me is null or other is null or other = me then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if public.is_blocked_between(me, other) then
    return 'unavailable';
  end if;

  select * into existing from friendships
   where (requester_id = me and addressee_id = other)
      or (requester_id = other and addressee_id = me)
   limit 1;

  if not found then
    insert into friendships (requester_id, addressee_id, status) values (me, other, 'pending');
    return 'requested';
  end if;
  if existing.status = 'accepted' then
    return 'friends';
  end if;
  if existing.requester_id = other then
    update friendships set status = 'accepted' where id = existing.id;
    return 'friends';
  end if;
  return 'requested';
end;
$$;

revoke execute on function public.request_friend(uuid) from public, anon;
grant execute on function public.request_friend(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- REPORTS
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'message', 'photo', 'event')),
  target_id uuid not null,
  -- Who the reported thing belongs to, so you can act on the person.
  target_user_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'impersonation', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  -- For you: open until you've looked at it.
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports (status, created_at);

alter table public.reports enable row level security;

-- People file reports and can see their own; only you (the dashboard) see
-- the rest or change their status.
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open');
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));

-- Keeps reports useful: no more than 20 a day from one person, and one
-- report per person per thing.
create unique index if not exists reports_one_per_target on public.reports (reporter_id, target_type, target_id);

create or replace function public.reports_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from reports
       where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many reports today' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.reports_limit() from public, anon, authenticated;

drop trigger if exists reports_limit on public.reports;
create trigger reports_limit
  before insert on public.reports
  for each row execute function public.reports_limit();
