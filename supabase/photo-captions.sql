-- AI captions for the video recap: one short line describing a photo,
-- written once by the caption-photos edge function (Gemini) and reused
-- after that, so each photo costs at most one model call ever.
-- Readable by anyone who can see the photo; only the server writes them
-- (no insert/update grants for app users). Run after policies.sql and
-- photo-reactions.sql. Safe to re-run.

create table if not exists public.photo_captions (
  photo_id uuid primary key references public.photos (id) on delete cascade,
  caption text not null check (char_length(caption) between 1 and 120),
  model text,
  created_at timestamptz not null default now()
);

alter table public.photo_captions enable row level security;
revoke all on public.photo_captions from anon;
revoke all on public.photo_captions from authenticated;
grant select on public.photo_captions to authenticated;

-- Seeing a caption goes through the photo itself: the subquery runs with
-- the person's own rules on photos (members of the event, photo not
-- hidden), so a caption is exactly as visible as its photo.
drop policy if exists "photo_captions_select_visible" on public.photo_captions;
create policy "photo_captions_select_visible" on public.photo_captions
  for select to authenticated
  using (exists (select 1 from public.photos p where p.id = photo_id));
