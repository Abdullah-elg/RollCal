-- Video recaps are a paid feature. Anyone in an event may make the video
-- when the event is on a paid tier (the host is on Plus or Pro, it has an
-- Event Pass, or it's kept forever: private.event_tier) or they are on a
-- paid plan themselves, the same "better of the event's and yours" rule as
-- uploads. The picture recap stays free.
--
-- Also adds a "looks great" score (1-10) to each AI caption, used with
-- reactions to pick a recap's highlight photos.
-- Run after plans.sql and photo-captions.sql. Safe to re-run.

alter table public.photo_captions
  add column if not exists score smallint check (score between 1 and 10);

-- true when the signed-in person may make this event's video recap.
create or replace function public.recap_video_allowed(eid uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(eid, auth.uid()) then
    return false;
  end if;
  return private.event_tier(eid) is not null
      or private.effective_plan(auth.uid()) in ('plus', 'pro');
end;
$$;

revoke execute on function public.recap_video_allowed(uuid) from public, anon;
grant execute on function public.recap_video_allowed(uuid) to authenticated;
