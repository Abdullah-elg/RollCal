-- ============================================================================
-- RollCal - The number on the app icon
-- Run after chat-reads.sql. Safe to re-run.
--
-- One number per person: event chats with messages they haven't read, plus
-- friend requests and event invites waiting on them. send-push puts it on
-- every notification, so it updates while the app is closed. While it's
-- open, the app sets the number itself from what it already knows
-- (src/context/UnreadContext.tsx).
--
-- A chat counts as unread when someone else wrote after the person last read
-- it (chat_reads). Messages from people they've blocked don't count, and
-- messages from before "seen by" existed don't either, so nobody's badge
-- starts out counting every old chat.
-- ============================================================================

create or replace function private.badge_count(uid uuid)
returns integer language sql stable security definer set search_path = public as $$
  select
    (select count(distinct m.event_id)::integer
       from messages m
       left join chat_reads r on r.event_id = m.event_id and r.user_id = uid
      where m.sender_id <> uid
        and m.created_at > coalesce(r.last_read_at, timestamptz '2026-10-26 00:00:00+00')
        and private.is_member(m.event_id, uid)
        and not exists (select 1 from blocks b where b.blocker_id = uid and b.blocked_id = m.sender_id))
  + (select count(*)::integer from friendships
      where addressee_id = uid and status = 'pending')
  + (select count(*)::integer from invitations
      where invited_user_id = uid and status = 'pending');
$$;

revoke execute on function private.badge_count(uuid) from public, anon, authenticated;

-- For send-push (service role only): counts for everyone it's notifying.
create or replace function public.badge_counts(p_users uuid[])
returns table (user_id uuid, n integer)
language sql stable security definer set search_path = public as $$
  select u, private.badge_count(u) from unnest(p_users) as u;
$$;

revoke execute on function public.badge_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.badge_counts(uuid[]) to service_role;
