-- ============================================================================
-- RollCal - Push notifications
-- Run after safety.sql and expiry.sql (it uses is_quiet, is_blocked_between,
-- pg_cron and pg_net). Safe to re-run. Deploy supabase/functions/send-push
-- with "Enforce JWT verification" OFF; it checks the key made here instead.
--
-- How it works:
--   1. Each phone registers its Expo push token with register_push_token,
--      along with its notification settings (they live on the phone) and
--      the chats muted on it.
--   2. Things people do (a friend request, a chat message) and the roll
--      opening add rows to push_outbox, one per person to tell.
--   3. Each batch of new rows pokes the send-push edge function, which sends
--      them through Expo to every phone of that person that wants that kind,
--      and forgets tokens Expo says are dead. A cron job retries anything
--      left behind and clears old rows.
--
-- Nothing here is readable from the app except a person's own tokens.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;


-- ----------------------------------------------------------------------------
-- TOKENS
-- ----------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token text primary key
    check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' and char_length(token) <= 200),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  -- The phone's notification settings, e.g. {"chatMessage": false}. A kind
  -- missing here counts as on.
  prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  -- Events whose chat is muted on this phone.
  muted_events uuid[] not null default '{}' check (cardinality(muted_events) <= 1000),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- People see their own tokens; all changes go through the functions below.
drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

-- Saves this phone's token and settings for the signed-in person. A phone
-- that signs into another account moves its token over, so the old account
-- stops getting its notifications. At most 10 phones per person; the
-- longest unused go first.
create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_prefs jsonb default '{}'::jsonb,
  p_muted uuid[] default '{}'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into push_tokens (token, user_id, platform, prefs, muted_events, updated_at)
  values (p_token, me, p_platform, coalesce(p_prefs, '{}'::jsonb), coalesce(p_muted, '{}'), now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        prefs = excluded.prefs,
        muted_events = excluded.muted_events,
        updated_at = now();

  delete from push_tokens
   where user_id = me
     and token in (select token from push_tokens where user_id = me
                    order by updated_at desc offset 10);
end;
$$;

-- On sign-out, so a shared phone stops getting the last person's messages.
create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.register_push_token(text, text, jsonb, uuid[]) to authenticated;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;


-- ----------------------------------------------------------------------------
-- OUTBOX
-- One row per person to tell. kind matches the app's notification settings
-- so each phone can opt out. claimed_at is set when send-push picks it up.
-- ----------------------------------------------------------------------------
create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen')),
  -- For chat, so phones that muted this event's chat skip it.
  event_id uuid,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists push_outbox_unclaimed_idx on public.push_outbox (id) where claimed_at is null;

-- No policies: only the edge function (service role) reads it.
alter table public.push_outbox enable row level security;

-- A display name for notifications: first name, else the full name.
create or replace function public.push_name(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(first_name), ''), nullif(btrim(display_name), ''), 'Someone')
    from profiles where id = uid;
$$;

-- Everyone in an event: the host, anyone who RSVP'd and anyone who accepted
-- an invite, minus people banned from it. rsvp is the one that counts most:
-- host, then their answer, then 'invited'.
create or replace function public.event_people(eid uuid)
returns table (user_id uuid, rsvp text)
language sql stable security definer set search_path = public as $$
  select p.user_id,
         (array_agg(p.rsvp order by case p.rsvp when 'host' then 0 when 'going' then 1
                                                when 'maybe' then 2 when 'not_going' then 3
                                                else 4 end))[1]
    from (
      select e.creator_id as user_id, 'host' as rsvp from events e where e.id = eid
      union all
      select r.user_id, r.status::text from rsvps r where r.event_id = eid
      union all
      select i.invited_user_id, 'invited' from invitations i
       where i.event_id = eid and i.status = 'accepted'
    ) p
   where not public.is_banned(eid, p.user_id)
   group by p.user_id;
$$;

revoke execute on function public.push_name(uuid) from public, anon, authenticated;
revoke execute on function public.event_people(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- WHAT GETS SENT
-- ----------------------------------------------------------------------------

-- Friend requests (not to someone in Quiet mode, whose requests are hidden)
-- and accepted requests, which go back to the person who asked.
create or replace function public.push_friendships()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' and not public.is_quiet(new.addressee_id) then
    insert into push_outbox (user_id, kind, title, body, data)
    values (new.addressee_id, 'friendRequest', public.push_name(new.requester_id),
            'wants to be friends.', jsonb_build_object('type', 'friends'));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into push_outbox (user_id, kind, title, body, data)
    values (new.requester_id, 'friendAccepted', public.push_name(new.addressee_id),
            'accepted your friend request.', jsonb_build_object('type', 'friends'));
  end if;
  return null;
end;
$$;

drop trigger if exists push_friendships on public.friendships;
create trigger push_friendships
  after insert or update of status on public.friendships
  for each row execute function public.push_friendships();

-- A chat message goes to everyone else in the event, except people who've
-- blocked the sender or been blocked by them.
create or replace function public.push_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ev_title text;
  who text := public.push_name(new.sender_id);
  preview text := left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 140);
begin
  select title into ev_title from events where id = new.event_id;
  insert into push_outbox (user_id, kind, event_id, title, body, data)
  select p.user_id, 'chatMessage', new.event_id, coalesce(ev_title, 'Event chat'),
         who || ': ' || preview,
         jsonb_build_object('type', 'chat', 'eventId', new.event_id, 'title', ev_title)
    from public.event_people(new.event_id) p
   where p.user_id <> new.sender_id
     and not public.is_blocked_between(p.user_id, new.sender_id);
  return null;
end;
$$;

drop trigger if exists push_messages on public.messages;
create trigger push_messages
  after insert on public.messages
  for each row execute function public.push_messages();

-- The roll opens when an event ends. A cron job (below) announces events
-- that ended in the last few hours, once each. Moving an event's end time
-- later lets it be announced again.
alter table public.events add column if not exists roll_open_pushed_at timestamptz;

create or replace function public.events_reset_roll_push()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.ends_at is distinct from old.ends_at and new.ends_at > now() then
    new.roll_open_pushed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists events_reset_roll_push on public.events;
create trigger events_reset_roll_push
  before update of ends_at on public.events
  for each row execute function public.events_reset_roll_push();

-- Everyone but the people who said they can't go.
create or replace function public.push_roll_openings()
returns integer language plpgsql security definer set search_path = public as $$
declare
  ev record;
  n integer := 0;
begin
  for ev in
    update events
       set roll_open_pushed_at = now()
     where roll_open_pushed_at is null
       and ends_at <= now()
       and ends_at > now() - interval '6 hours'
       and not coalesce(uploads_closed, false)
    returning id, title
  loop
    insert into push_outbox (user_id, kind, event_id, title, body, data)
    select p.user_id, 'albumOpen', ev.id, ev.title, 'The roll is open - add your photos.',
           jsonb_build_object('type', 'event', 'eventId', ev.id)
      from public.event_people(ev.id) p
     where p.rsvp is distinct from 'not_going';
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.push_friendships() from public, anon, authenticated;
revoke execute on function public.push_messages() from public, anon, authenticated;
revoke execute on function public.events_reset_roll_push() from public, anon, authenticated;
revoke execute on function public.push_roll_openings() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- SENDING
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_key');
  end if;
end $$;

-- Only the edge function (service role) may check the key.
create or replace function public.push_key_ok(key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vault.decrypted_secrets where name = 'push_key' and decrypted_secret = key
  );
$$;

revoke execute on function public.push_key_ok(text) from public, anon, authenticated;
grant execute on function public.push_key_ok(text) to service_role;

-- Hands send-push the next rows to send and marks them taken, so two runs
-- at once never send the same row twice.
create or replace function public.claim_push_outbox(max_rows integer default 500)
returns setof public.push_outbox
language sql security definer set search_path = public as $$
  update push_outbox o
     set claimed_at = now()
   where o.id in (
     select id from push_outbox
      where claimed_at is null
      order by id
      limit max_rows
      for update skip locked
   )
  returning o.*;
$$;

revoke execute on function public.claim_push_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_push_outbox(integer) to service_role;

-- Asks send-push to run. pg_net sends the request after the transaction
-- commits, so rolled-back work never gets sent.
create or replace function public.poke_send_push()
returns void language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := 'https://qwtvpmrxmlfuwmnyawcq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-push-key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

-- Once per statement, so a message to 20 people is one request, and none
-- when there was nobody to tell.
create or replace function public.push_outbox_poke()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from added) then
    perform public.poke_send_push();
  end if;
  return null;
end;
$$;

revoke execute on function public.poke_send_push() from public, anon, authenticated;
revoke execute on function public.push_outbox_poke() from public, anon, authenticated;

drop trigger if exists push_outbox_poke on public.push_outbox;
create trigger push_outbox_poke
  after insert on public.push_outbox
  referencing new table as added
  for each statement execute function public.push_outbox_poke();


-- Every minute: announce rolls that just opened, retry anything not sent
-- (say the function was briefly down), and clear rows older than two days.
select cron.unschedule('push-tick')
 where exists (select 1 from cron.job where jobname = 'push-tick');

select cron.schedule(
  'push-tick',
  '* * * * *',
  $job$
    select public.push_roll_openings();
    select public.poke_send_push()
     where exists (select 1 from public.push_outbox
                    where claimed_at is null and created_at < now() - interval '1 minute');
    delete from public.push_outbox where created_at < now() - interval '2 days';
  $job$
);
