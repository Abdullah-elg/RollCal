-- Who can see your profile photo: friends only (how it has always worked)
-- or everyone signed in. Set in Settings -> Privacy. Enforced where photo
-- links are handed out: readable_media (the media Worker's R2 links) and
-- the Supabase Storage read rule for the avatars bucket. Run after
-- media-r2.sql. Safe to re-run.

alter table public.profiles add column if not exists avatar_public boolean not null default false;

-- May viewer see owner's profile photo? Yourself, your friends, or anyone
-- when the owner chose everyone.
create or replace function private.avatar_visible(viewer uuid, owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select viewer is not null and (
    viewer = owner
    or private.are_friends(viewer, owner)
    or coalesce((select p.avatar_public from public.profiles p where p.id = owner), false)
  );
$$;

revoke execute on function private.avatar_visible(uuid, uuid) from public, anon;
grant execute on function private.avatar_visible(uuid, uuid) to authenticated, service_role;

-- readable_media as it is live, with only the avatars rule changed.
CREATE OR REPLACE FUNCTION public.readable_media(p_bucket text, p_names text[])
 RETURNS TABLE(name text, has_thumb boolean, in_r2 boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select n.name, coalesce(m.thumb_bytes > 0, false), m.stored_at is not null
    from (select distinct unnest(p_names[1:200]) as name) n
    left join public.media_objects m on m.bucket = p_bucket and m.name = n.name
   where auth.uid() is not null
     and split_part(n.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and case p_bucket
           when 'event-photos' then
             private.is_member(split_part(n.name, '/', 1)::uuid, auth.uid())
             and not private.photo_file_held(n.name)
           when 'avatars' then
             private.avatar_visible(auth.uid(), split_part(n.name, '/', 1)::uuid)
           else false
         end;
$function$;

-- Supabase Storage (older photos and fallback uploads): same rule.
drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.avatar_visible((select auth.uid()), ((storage.foldername(name))[1])::uuid)
  );
