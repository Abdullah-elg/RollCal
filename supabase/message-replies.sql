-- ============================================================================
-- RollCal - Replying to a chat message
-- Run after message-edits.sql. Safe to re-run.
--
-- A message can point at the one it answers (reply_to). The chat shows a
-- quote of it above the reply. Only a message in the same event chat can be
-- quoted, so a reply can't pull text out of a chat you're not in. If the
-- quoted message is deleted, the reply stays and just loses its quote.
-- ============================================================================

alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

create index if not exists messages_reply_to_idx
  on public.messages (reply_to) where reply_to is not null;

grant insert (reply_to) on public.messages to authenticated;

create or replace function private.messages_reply_same_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to is not null
     and not exists (select 1 from messages m
                      where m.id = new.reply_to and m.event_id = new.event_id) then
    raise exception 'You can only reply to a message in this chat' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.messages_reply_same_chat() from public, anon, authenticated;

drop trigger if exists messages_reply_same_chat on public.messages;
create trigger messages_reply_same_chat
  before insert or update of reply_to on public.messages
  for each row execute function private.messages_reply_same_chat();
