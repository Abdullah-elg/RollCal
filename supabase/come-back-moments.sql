-- Stage 3: come-back moments (2026-11-27). Safe to run more than once.
--
-- 1. "Your photos are ready": the morning after an event, one push to the
--    people who went (host, going, maybe) with how many photos there are.
--    Sent 9 to 30 hours after the event ends, so a night out lands the next
--    morning, and only once per event.
-- 2. Memories: a month and a year after an event that still has photos,
--    one push each ("1 year ago today: Lake weekend"). Once per person,
--    event and milestone.
--
-- Both are new push kinds; each phone can turn them off in Settings
-- (photosReady, memories), and the push sender skips anyone who did.

alter table public.events add column if not exists reveal_pushed_at timestamptz;

alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind = any (array[
  'friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen', 'joinRequest', 'joinApproved',
  'eventDeleting', 'hostReport', 'eventFull', 'photosReady', 'memory'
]));

-- 1. The morning-after reveal.
create or replace function public.push_photo_reveals()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ev record;
  n integer := 0;
begin
  for ev in
    update public.events e set reveal_pushed_at = now()
     where e.reveal_pushed_at is null
       and e.ends_at <= now() - interval '9 hours'
       and e.ends_at > now() - interval '30 hours'
       and e.photos_expired_at is null
       and e.delete_at is null
       and exists (select 1 from public.photos p where p.event_id = e.id and p.hidden_at is null)
    returning e.id, e.title
  loop
    insert into public.push_outbox (user_id, kind, event_id, title, body, data)
    select pe.user_id, 'photosReady', ev.id, ev.title,
           c.photos || case when c.photos = 1 then ' photo' else ' photos' end
             || case when c.people > 1 then ' from ' || c.people || ' people' else '' end
             || '. Your photos are ready.',
           jsonb_build_object('type', 'photos', 'eventId', ev.id)
      from public.event_people(ev.id) pe,
           lateral (select count(*) as photos, count(distinct p.uploader_id) as people
                      from public.photos p where p.event_id = ev.id and p.hidden_at is null) c
     where pe.rsvp is distinct from 'not_going';
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.push_photo_reveals() from public, anon, authenticated;

-- 2. Memories, a month and a year on.
create table if not exists private.memory_pushes (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  milestone text not null check (milestone in ('month', 'year')),
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id, milestone)
);
alter table private.memory_pushes enable row level security;

create or replace function public.push_memories()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  with due as (
    select e.id, e.title, m.milestone
      from public.events e
      cross join (values ('month', interval '1 month'), ('year', interval '1 year')) as m(milestone, ago)
     where (e.ends_at at time zone 'utc')::date = ((now() - m.ago) at time zone 'utc')::date
       and e.photos_expired_at is null
       and e.delete_at is null
       and exists (select 1 from public.photos p where p.event_id = e.id and p.hidden_at is null)
  ), people as (
    select d.id, d.title, d.milestone, pe.user_id
      from due d
      cross join lateral public.event_people(d.id) pe
     where pe.rsvp is distinct from 'not_going'
  ), fresh as (
    insert into private.memory_pushes (event_id, user_id, milestone)
    select id, user_id, milestone from people
    on conflict do nothing
    returning event_id, user_id, milestone
  )
  insert into public.push_outbox (user_id, kind, event_id, title, body, data)
  select f.user_id, 'memory', f.event_id,
         case f.milestone when 'year' then '1 year ago today' else '1 month ago today' end,
         p.title || '. Take a look back at the photos.',
         jsonb_build_object('type', 'photos', 'eventId', f.event_id)
    from fresh f join people p on p.id = f.event_id and p.user_id = f.user_id and p.milestone = f.milestone;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.push_memories() from public, anon, authenticated;

-- The schedule: reveals every 15 minutes, memories once a day (16:00 UTC,
-- late morning in the Americas, evening in Europe). Each then wakes the
-- push sender, like the other push jobs.
select cron.unschedule(jobid) from cron.job where jobname in ('photo-reveals', 'memories');
select cron.schedule('photo-reveals', '*/15 * * * *', $c$
  select public.push_photo_reveals();
  select public.poke_send_push();
$c$);
select cron.schedule('memories', '0 16 * * *', $c$
  select public.push_memories();
  select public.poke_send_push();
$c$);
