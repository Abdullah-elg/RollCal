-- Reactions on photos: ❤️ 😂 🔥. Anyone who can see a photo can react to it,
-- once per emoji, and take their reaction back. Run after policies.sql and
-- host-reports.sql. Safe to re-run.

create table if not exists public.photo_reactions (
  photo_id uuid not null references public.photos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '😂', '🔥')),
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id, emoji)
);

create index if not exists photo_reactions_user_idx on public.photo_reactions (user_id);

alter table public.photo_reactions enable row level security;
revoke all on public.photo_reactions from anon;
grant select, insert, delete on public.photo_reactions to authenticated;

-- Seeing and adding go through the photo itself: the subquery runs with the
-- person's own rules on photos (members of the event, photo not hidden), so
-- reactions are exactly as visible as the photo.
drop policy if exists "photo_reactions_select_visible" on public.photo_reactions;
create policy "photo_reactions_select_visible" on public.photo_reactions
  for select to authenticated
  using (exists (select 1 from public.photos p where p.id = photo_id));

drop policy if exists "photo_reactions_insert_own" on public.photo_reactions;
create policy "photo_reactions_insert_own" on public.photo_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.photos p where p.id = photo_id)
  );

drop policy if exists "photo_reactions_delete_own" on public.photo_reactions;
create policy "photo_reactions_delete_own" on public.photo_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));
