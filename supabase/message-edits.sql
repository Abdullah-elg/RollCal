-- ============================================================================
-- RollCal - Editing chat messages
-- Run after policies.sql. Safe to re-run.
--
-- Deleting already works: messages_delete_own_or_leader lets the sender and
-- the host delete a message. This adds editing:
--   * only the sender, only within 10 minutes of sending, only the text;
--   * edited_at marks it, so the chat can say "Edited";
--   * done through edit_message, which uses the server's clock, so the
--     10 minutes can't be stretched by a phone's wrong time.
-- There is still no update policy on messages, so nothing else can change.
-- ============================================================================

alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.edit_message(p_message uuid, p_body text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  new_body text := btrim(p_body);
  stamped timestamptz := now();
begin
  if char_length(new_body) < 1 or char_length(new_body) > 1000 then
    raise exception 'Messages are 1 to 1000 characters' using errcode = '23514';
  end if;
  update messages
     set body = new_body, edited_at = stamped
   where id = p_message
     and sender_id = auth.uid()
     and created_at > now() - interval '10 minutes'
     and private.is_member(event_id, auth.uid());
  if not found then
    raise exception 'This message can''t be edited any more' using errcode = '42501';
  end if;
  return stamped;
end;
$$;

revoke execute on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;
