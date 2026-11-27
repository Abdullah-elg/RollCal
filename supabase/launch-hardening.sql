-- ============================================================================
-- RollCal - Hardening before launch
-- Run after seen-sync.sql and reserved-domain.sql (and after private-schema.sql,
-- whose helpers this uses). Safe to re-run. Re-run it after re-running
-- policies.sql, media.sql, push.sql, join-modes.sql, schema-updates.sql,
-- expiry.sql or event-delete.sql: it replaces things those files own.
--
-- Fixes from the pre-launch review. Nothing a person does in the app today
-- stops working; the limits are far above what real people hit.
--   1. Receipt scans are claimed before the photo is read, one at a time per
--      person, so many requests at once can't all slip past the free
--      allowance. The scan-receipt edge function gives the scan back if the
--      reading fails on our side.
--   2. register_push_token does nothing when nothing changed in the last
--      minute (an older build calls it in a loop).
--   3. Friend and join requests push once a day per person and kind, however
--      often someone cancels and asks again; and 50 new friend requests a
--      day each.
--   4. 30 chat messages a minute each.
--   5. The roll's upload window (src/lib/roll.ts) is enforced here too, for
--      photo rows and for the files themselves, with an hour of slack either
--      side for phone clocks and uploads in progress.
--   6. Free accounts can't put videos in storage directly.
--   7. events.invite_code is unique.
--   8. An invite request between people who've blocked each other can't be
--      approved; a report's target_user_id comes from the reported thing,
--      not the app; at most 5 profile photo files per person.
--   9. The expire-photos job runs hourly again (expiry.sql sets it daily;
--      event-delete.sql made it hourly).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. RECEIPT SCANS: claim first, read second
-- The edge function calls this as the signed-in person before sending the
-- photo to Gemini. Pro: allowed, nothing recorded. Free with scans left: the
-- scan is recorded now and its id returned, so the function can delete it
-- if the reading fails on our side. None left: not allowed. The lock makes
-- two requests from the same person take turns, so both can't see "1 left".
-- ----------------------------------------------------------------------------
create or replace function public.claim_receipt_scan()
returns table (allowed boolean, scan_id bigint, scans_left integer)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  left_now integer;
  new_id bigint;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('receipt_scan:' || me::text, 0));

  -- The allowance itself stays in one place (scan-allowance.sql).
  left_now := public.receipt_scans_left();
  if left_now is null then
    return query select true, null::bigint, null::integer;
    return;
  end if;
  if left_now <= 0 then
    return query select false, null::bigint, 0;
    return;
  end if;

  insert into receipt_scans (user_id) values (me) returning id into new_id;
  return query select true, new_id, left_now - 1;
end;
$$;

revoke execute on function public.claim_receipt_scan() from public, anon;
grant execute on function public.claim_receipt_scan() to authenticated;


-- ----------------------------------------------------------------------------
-- 2. PUSH TOKENS: a cheap no-op when nothing changed
-- Same as push.sql, plus the early return at the top.
-- ----------------------------------------------------------------------------
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
  -- Saved the same thing for the same person in the last minute: nothing to do.
  if exists (
    select 1 from push_tokens
     where token = p_token
       and user_id = me
       and platform = p_platform
       and prefs = coalesce(p_prefs, '{}'::jsonb)
       and muted_events = coalesce(p_muted, '{}')
       and updated_at > now() - interval '1 minute'
  ) then
    return;
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

revoke execute on function public.register_push_token(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.register_push_token(text, text, jsonb, uuid[]) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. REQUEST PUSHES: once a day per sender, recipient and kind
-- push_outbox doesn't say who caused a row, so a small table remembers the
-- last request push between two people (and event, for join requests).
-- The request itself still shows in the app every time; only the extra
-- pushes are skipped.
-- ----------------------------------------------------------------------------
create table if not exists private.push_dedupe (
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  -- The event for join requests; all zeros otherwise.
  event_key uuid not null default '00000000-0000-0000-0000-000000000000',
  sent_at timestamptz not null default now(),
  primary key (sender_id, recipient_id, kind, event_key)
);
create index if not exists push_dedupe_recipient_idx on private.push_dedupe (recipient_id);

alter table private.push_dedupe enable row level security;
revoke all on private.push_dedupe from public, anon, authenticated;

-- True (and remembered) if this push hasn't gone out in the last 24 hours.
-- One statement, so two at once can't both say yes.
create or replace function private.push_once(p_sender uuid, p_recipient uuid, p_kind text, p_event uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  ok boolean;
begin
  insert into private.push_dedupe as d (sender_id, recipient_id, kind, event_key, sent_at)
  values (p_sender, p_recipient, p_kind,
          coalesce(p_event, '00000000-0000-0000-0000-000000000000'), now())
  on conflict (sender_id, recipient_id, kind, event_key) do update
    set sent_at = now()
    where d.sent_at < now() - interval '24 hours'
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

revoke execute on function private.push_once(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Same as push.sql (with is_quiet where private-schema.sql moved it), plus
-- the once-a-day check on new requests.
create or replace function public.push_friendships()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' and not private.is_quiet(new.addressee_id) then
    if private.push_once(new.requester_id, new.addressee_id, 'friendRequest', null) then
      insert into push_outbox (user_id, kind, title, body, data)
      values (new.addressee_id, 'friendRequest', public.push_name(new.requester_id),
              'wants to be friends.', jsonb_build_object('type', 'friends'));
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into push_outbox (user_id, kind, title, body, data)
    values (new.requester_id, 'friendAccepted', public.push_name(new.addressee_id),
            'accepted your friend request.', jsonb_build_object('type', 'friends'));
  end if;
  return null;
end;
$$;

revoke execute on function public.push_friendships() from public, anon, authenticated;

drop trigger if exists push_friendships on public.friendships;
create trigger push_friendships
  after insert or update of status on public.friendships
  for each row execute function public.push_friendships();

-- Same as join-modes.sql, plus the once-a-day check.
create or replace function public.push_join_requests()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  host uuid;
begin
  select creator_id into host from events where id = new.event_id;
  if host is null or not private.push_once(new.user_id, host, 'joinRequest', new.event_id) then
    return null;
  end if;
  insert into push_outbox (user_id, kind, event_id, title, body, data)
  select e.creator_id, 'joinRequest', e.id, e.title,
         public.push_name(new.user_id) || ' wants to join.',
         jsonb_build_object('type', 'event', 'eventId', e.id)
    from events e
   where e.id = new.event_id;
  return null;
end;
$$;

revoke execute on function public.push_join_requests() from public, anon, authenticated;

drop trigger if exists push_join_requests on public.event_join_requests;
create trigger push_join_requests
  after insert on public.event_join_requests
  for each row execute function public.push_join_requests();

-- 50 new friend requests a day each. Counted on every new request (cancelling
-- doesn't give one back), whether it comes through request_friend or an
-- older build's direct insert. The dashboard and service role aren't limited.
create table if not exists private.friend_request_log (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists friend_request_log_idx on private.friend_request_log (requester_id, created_at);

alter table private.friend_request_log enable row level security;
revoke all on private.friend_request_log from public, anon, authenticated;

create or replace function private.friend_requests_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.status <> 'pending' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('friend_request:' || new.requester_id::text, 0));
  if (select count(*) from private.friend_request_log
       where requester_id = new.requester_id and created_at > now() - interval '1 day') >= 50 then
    raise exception 'You’ve sent a lot of friend requests today. Try again tomorrow.'
      using errcode = '42501';
  end if;
  insert into private.friend_request_log (requester_id) values (new.requester_id);
  return new;
end;
$$;

revoke execute on function private.friend_requests_limit() from public, anon, authenticated;

drop trigger if exists friendships_request_limit on public.friendships;
create trigger friendships_request_limit
  before insert on public.friendships
  for each row execute function private.friend_requests_limit();

-- Both tables only need the last day.
select cron.unschedule('launch-hardening-prune')
 where exists (select 1 from cron.job where jobname = 'launch-hardening-prune');

select cron.schedule(
  'launch-hardening-prune',
  '41 4 * * *',
  $job$
    delete from private.push_dedupe where sent_at < now() - interval '2 days';
    delete from private.friend_request_log where created_at < now() - interval '2 days';
  $job$
);


-- ----------------------------------------------------------------------------
-- 4. CHAT: 30 messages a minute each
-- The time a message was sent is the server's, so neither this limit nor the
-- 10-minute edit window can be dodged by back-dating (the app never sends it).
-- ----------------------------------------------------------------------------
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at);

create or replace function private.messages_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.created_at := now();
  if (select count(*) from messages
       where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'You’re sending messages very fast. Wait a moment and try again.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.messages_rate_limit() from public, anon, authenticated;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function private.messages_rate_limit();


-- ----------------------------------------------------------------------------
-- 5. THE ROLL'S UPLOAD WINDOW
-- Mirrors rollState() in src/lib/roll.ts: open from the event's start until
-- 48 hours after it ends, or until uploads_reopened_until if that's later,
-- unless the host closed it (uploads_closed). The host has no exception in
-- the app, so none here. Also shut once the photos have expired or the event
-- is about to be deleted. The hour either side covers phone clocks that are
-- off and an upload started just before the roll closed.
-- ----------------------------------------------------------------------------
create or replace function private.roll_open(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from events e
     where e.id = eid
       and not coalesce(e.uploads_closed, false)
       and e.photos_expired_at is null
       and e.delete_at is null
       and now() >= e.starts_at - interval '1 hour'
       and now() <= greatest(e.ends_at + interval '48 hours',
                             coalesce(e.uploads_reopened_until, e.ends_at + interval '48 hours'))
                    + interval '1 hour'
  );
$$;

revoke execute on function private.roll_open(uuid) from public, anon;
grant execute on function private.roll_open(uuid) to authenticated, service_role;

-- Photo rows: same as policies.sql, plus the window.
drop policy if exists "photos_insert_member" on public.photos;
create policy "photos_insert_member" on public.photos
  for insert to authenticated
  with check (
    uploader_id = (select auth.uid())
    and private.is_member(event_id, (select auth.uid()))
    and private.roll_open(event_id)
  );


-- ----------------------------------------------------------------------------
-- 6. VIDEOS IN STORAGE ARE PRO ONLY
-- photos_from_file (media.sql) already refuses a free account's video row,
-- but the file itself could still be stored. Storage may not have read the
-- file's type yet when this runs, so the file name's extension is checked
-- too. Pictures are never affected.
-- ----------------------------------------------------------------------------
create or replace function private.media_allowed(p_name text, p_metadata jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_pro from profiles where id = auth.uid()), false)
      or (
        coalesce(lower(substring(p_name from '\.([^./]+)$')), '') not in
          ('mp4', 'mov', 'm4v', 'qt', '3gp', '3g2', 'webm', 'mkv', 'avi', 'hevc', 'mpg', 'mpeg')
        and coalesce(p_metadata->>'mimetype', '') not like 'video/%'
      );
$$;

revoke execute on function private.media_allowed(text, jsonb) from public, anon;
grant execute on function private.media_allowed(text, jsonb) to authenticated, service_role;

-- The event-photos upload rule: media.sql's (members, with room), plus the
-- window and the video check.
drop policy if exists "event_photos_upload_member" on storage.objects;
create policy "event_photos_upload_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    and private.is_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
    and (select private.can_upload())
    and private.roll_open(((storage.foldername(name))[1])::uuid)
    and private.media_allowed(name, metadata)
  );


-- ----------------------------------------------------------------------------
-- 7. INVITE CODES ARE UNIQUE
-- Only added if no unique index on invite_code exists yet and there are no
-- duplicates; otherwise it says so and changes nothing.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indrelid = 'public.events'::regclass
       and i.indisunique and i.indnatts = 1 and i.indpred is null
       and a.attname = 'invite_code'
  ) then
    return;
  end if;
  if exists (
    select 1 from public.events where invite_code is not null
     group by invite_code having count(*) > 1
  ) then
    raise notice 'events.invite_code has duplicates, so no unique index was added. Give those events new codes and re-run this file.';
    return;
  end if;
  create unique index if not exists events_invite_code_unique on public.events (invite_code);
end $$;


-- ----------------------------------------------------------------------------
-- 8a. INVITE REQUESTS: never between people who've blocked each other
-- Same as schema-updates.sql, plus the block check: between the person
-- suggested and either the friend who suggested them or the host.
-- ----------------------------------------------------------------------------
create or replace function public.approve_invite_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.event_invite_requests%rowtype;
begin
  select * into v_req
  from public.event_invite_requests
  where id = p_request_id;

  if not found then
    raise exception 'Invite request not found';
  end if;

  if not exists (
    select 1 from public.events
    where id = v_req.event_id and creator_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  if private.is_blocked_between(v_req.suggested_user_id, v_req.requested_by)
     or private.is_blocked_between(v_req.suggested_user_id, auth.uid()) then
    raise exception 'This person can''t be invited' using errcode = '42501';
  end if;

  insert into public.invitations (event_id, invited_user_id, invited_by, status)
  values (v_req.event_id, v_req.suggested_user_id, v_req.requested_by, 'pending')
  on conflict (event_id, invited_user_id) do nothing;

  delete from public.event_invite_requests where id = p_request_id;
end;
$$;

revoke execute on function public.approve_invite_request(uuid) from public, anon;
grant execute on function public.approve_invite_request(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 8b. REPORTS: who it's about comes from the reported thing
-- For reports from the app; the dashboard can still set it by hand.
-- ----------------------------------------------------------------------------
create or replace function private.reports_target_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.target_user_id := case new.target_type
    when 'user' then (select id from profiles where id = new.target_id)
    when 'message' then (select sender_id from messages where id = new.target_id)
    when 'photo' then (select uploader_id from photos where id = new.target_id)
    when 'event' then (select creator_id from events where id = new.target_id)
  end;
  return new;
end;
$$;

revoke execute on function private.reports_target_user() from public, anon, authenticated;

drop trigger if exists reports_target_user on public.reports;
create trigger reports_target_user
  before insert on public.reports
  for each row execute function private.reports_target_user();


-- ----------------------------------------------------------------------------
-- 8c. PROFILE PHOTOS: at most 5 files each
-- The app keeps one (it deletes the old file after a new one is saved).
-- ----------------------------------------------------------------------------
create or replace function private.avatar_folder_has_room()
returns boolean language sql stable security definer set search_path = public, storage as $$
  select count(*) < 5
    from storage.objects
   where bucket_id = 'avatars'
     and name like (select auth.uid())::text || '/%';
$$;

revoke execute on function private.avatar_folder_has_room() from public, anon;
grant execute on function private.avatar_folder_has_room() to authenticated, service_role;

-- Same as policies.sql, plus the cap.
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.avatar_folder_has_room())
  );


-- ----------------------------------------------------------------------------
-- 9. EXPIRE-PHOTOS RUNS HOURLY
-- Same job as event-delete.sql, in case expiry.sql was re-run after it.
-- ----------------------------------------------------------------------------
select cron.unschedule('expire-photos')
 where exists (select 1 from cron.job where jobname = 'expire-photos');

select cron.schedule(
  'expire-photos',
  '7 * * * *',
  $job$
    select net.http_post(
      url := 'https://qwtvpmrxmlfuwmnyawcq.supabase.co/functions/v1/expire-photos',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-expire-key', (select decrypted_secret from vault.decrypted_secrets where name = 'expire_photos_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
