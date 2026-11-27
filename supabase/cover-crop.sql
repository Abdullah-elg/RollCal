-- How the cover photo is framed (2026-11-27). Safe to run more than once.
--
-- The cover is now the full photo from the roll plus a frame the host
-- chose: the part of the photo shown in the 2:1 cover, as fractions of the
-- photo's width and height ({"x":0.1,"y":0.2,"w":0.8,"h":0.4}). Null means
-- "centred", which is how covers were shown before.
alter table public.events add column if not exists cover_crop jsonb;

alter table public.events drop constraint if exists events_cover_crop_shape;
alter table public.events add constraint events_cover_crop_shape check (
  cover_crop is null or (
    jsonb_typeof(cover_crop) = 'object'
    and jsonb_typeof(cover_crop->'x') = 'number' and jsonb_typeof(cover_crop->'y') = 'number'
    and jsonb_typeof(cover_crop->'w') = 'number' and jsonb_typeof(cover_crop->'h') = 'number'
    and (cover_crop->>'x')::numeric >= 0 and (cover_crop->>'y')::numeric >= 0
    and (cover_crop->>'w')::numeric > 0 and (cover_crop->>'h')::numeric > 0
    and (cover_crop->>'x')::numeric + (cover_crop->>'w')::numeric <= 1.001
    and (cover_crop->>'y')::numeric + (cover_crop->>'h')::numeric <= 1.001
  )
);

-- A new cover photo starts centred unless its frame is set at the same time
-- (choosing "Set as event photo" in the roll doesn't carry the old frame).
create or replace function private.events_cover_crop_reset()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cover_photo_id is distinct from old.cover_photo_id
     and new.cover_crop is not distinct from old.cover_crop then
    new.cover_crop := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.events_cover_crop_reset() from public, anon, authenticated;

drop trigger if exists events_cover_crop_reset on public.events;
create trigger events_cover_crop_reset
  before update of cover_photo_id on public.events
  for each row execute function private.events_cover_crop_reset();
