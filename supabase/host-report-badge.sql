-- The app-icon number on pushes also counts photos reported to you as host
-- that are still waiting on keep or delete: one per photo, the same as the
-- app (UnreadContext). Run after badge.sql and host-reports.sql.
-- Only private.badge_count changes; badge_counts and its grants stay as they are.

create or replace function private.badge_count(uid uuid)
returns integer
language sql stable security definer set search_path = public as $$
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
      where invited_user_id = uid and status = 'pending')
  + (select count(distinct photo_id)::integer from host_reports
      where host_id = uid and decision is null);
$$;

revoke execute on function private.badge_count(uuid) from public, anon, authenticated;
