-- Fix for media-r2.sql: the daily clean-up treated profile photos saved as
-- a full address (older accounts) as unused and would have deleted them
-- from R2 a day after the copy. Same function as in media-r2.sql now.

-- Reservations never finished within the hour, and files nothing uses a day
-- after they arrived (the app stopped between uploading and saving the photo
-- or profile): drop them, which queues them for deletion from R2.
create or replace function public.expire_media_reservations()
returns integer language sql volatile security definer set search_path = '' as $$
  with gone as (
    delete from public.media_objects m
     where (m.stored_at is null and m.created_at < now() - interval '1 hour')
        or (m.stored_at < now() - interval '1 day'
            and case m.bucket
                  when 'event-photos' then
                    not exists (select 1 from public.photos p where p.storage_path = m.name)
                  else
                    -- avatar_url is the name, or (older rows) a full address ending in it.
                    not exists (select 1 from public.profiles p
                                 where p.id = m.owner
                                   and (p.avatar_url = m.name
                                        or strpos(p.avatar_url, '/avatars/' || m.name) > 0))
                end)
    returning 1
  )
  select count(*)::integer from gone;
$$;
