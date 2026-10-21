-- ============================================================================
-- RollCal - Storage limits become totals
-- Run once on a database that already has media.sql and private-schema.sql.
-- Safe to re-run. (media.sql has the same change for fresh setups.)
--
-- Before: Free 2 GB of uploads a month; Pro 200 GB a month and 1 TB stored.
-- Now:    Free 2 GB stored in total; Pro 200 GB stored in total.
-- Stored = every file you uploaded to event rolls that's still there, so
-- deleting uploads or photos expiring frees space again.
-- ============================================================================

-- The result's shape changes, so the old functions go first.
drop function if exists public.my_upload_allowance();
drop function if exists public.upload_allowance(uuid);

create function public.upload_allowance(uid uuid)
returns table (
  is_pro boolean,
  stored bigint,
  stored_limit bigint
)
language sql stable security definer set search_path = public, storage as $$
  with me as (
    select coalesce((select p.is_pro from public.profiles p where p.id = uid), false) as pro
  )
  select
    me.pro,
    coalesce((select sum((o.metadata->>'size')::bigint)
                from storage.objects o
               where o.bucket_id = 'event-photos' and o.owner = uid), 0)::bigint,
    case when me.pro then 200 * 1024^3 else 2 * 1024^3 end::bigint
  from me;
$$;

-- The signed-in user's own numbers, for the app.
create function public.my_upload_allowance()
returns table (
  is_pro boolean,
  stored bigint,
  stored_limit bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.upload_allowance(auth.uid());
$$;

revoke execute on function public.upload_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.my_upload_allowance() from public, anon;
grant execute on function public.my_upload_allowance() to authenticated;

-- The upload rule's check, wherever it lives now (private-schema.sql moves
-- it out of the API).
create or replace function private.can_upload()
returns boolean language sql stable security definer set search_path = public as $$
  select a.stored < a.stored_limit
    from public.upload_allowance(auth.uid()) a;
$$;

revoke execute on function private.can_upload() from public, anon;
grant execute on function private.can_upload() to authenticated, service_role;
