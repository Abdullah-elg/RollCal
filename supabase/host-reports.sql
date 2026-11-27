-- ============================================================================
-- RollCal - Reporting a photo or video to the event's host
-- Run after plans.sql (and after report-email.sql, push.sql, event-delete.sql,
-- policies.sql and private-schema.sql, which it builds on). Safe to re-run.
-- Re-run it after re-running report-email.sql, safety.sql, event-delete.sql
-- or policies.sql (each replaces something this file changes). Redeploy
-- supabase/functions/report-email so its emails name the new reason (until
-- then they show "child_safety").
--
-- Someone reporting a photo or video in an album can send it to the host
-- instead of RollCal support. The host gets a push and an inbox item, sees
-- the photo, the reason and the details (never who reported it), and keeps
-- or deletes it. Reports to support work exactly as before.
--
-- WHAT THIS ADDS OR CHANGES
--   Columns and tables
--   * reports.reason and host_reports.reason: new reason 'child_safety'
--     ("Involves a child"), for any kind of report.
--   * photos.hidden_at: set when a host deletes a photo that was also sent
--     to support. The photo disappears for everyone, but the row and file
--     stay for support.
--   * reports.route ('support' or 'host', default 'support'). The reporter
--     already sees their own reports; this only says where they sent it.
--   * host_reports: the host's copy of a report sent to them. Its id is the
--     report's id. It has no reporter column, so nothing the host can read
--     says who reported. The host's decision lives only here, so the
--     reporter (who can read their own reports row) never sees it.
--     Its created_at is rounded down to the hour, so the time can't point
--     at who was looking at the album just then.
--     A separate table rather than more reports columns because Row Level
--     Security works on whole rows: letting the host read reports rows
--     would hand them reporter_id, and the reporter's own policy would
--     show them the host's decision.
--
--   Triggers
--   * reports_route (before insert on reports): a report goes to the host
--     only if it's about a photo or video, the event still has a host, the
--     reporter is a member, the reporter isn't the host and the uploader
--     isn't the host. Anything else becomes 'support', whatever the app sent.
--   * reports_to_host (after insert on reports): for a host report, adds the
--     host_reports row and queues one 'hostReport' push to the host. No
--     second push while an earlier report of the same photo is still
--     waiting for the host, and at most 5 of these pushes per host an hour
--     (a lock per host, so reports at the same moment can't both push).
--     The inbox still shows every waiting report.
--   The existing reports_limit (20 a day) and one-report-per-thing index
--   apply to host reports too, since they are reports rows.
--
--   Functions (private: only used inside other functions)
--   * report_is_serious(reason): harassment, hate, nudity, violence and
--     child_safety. These always reach RollCal support too, even when sent
--     to the host.
--   * photo_file_held(name): the file belongs to a hidden photo. Used by the
--     storage rules below.
--
--   Functions the app calls
--   * resolve_host_report(id, 'keep' | 'delete'): the event's host only.
--     'delete' deletes the photo row and returns 'deleted'; the app then
--     removes the file through the existing storage rule that lets the host
--     delete any file in their event (SQL may not delete storage files).
--     If any report of that photo was serious, it hides the photo instead
--     (photos.hidden_at) and returns 'hidden': the file stays for support.
--     Both record the decision on every waiting report of that photo.
--     Already decided: returns the decision on record and changes nothing.
--
--   Rules
--   * photos_select_member (replaced): members, and not hidden. Hidden
--     photos drop out of the album, counts, cover and inbox, and can't be
--     deleted from the app (deleting needs seeing).
--   * event_photos_read_member, event_photos_delete_owner_or_leader
--     (storage, replaced): as before, but not a hidden photo's file. The
--     support email signs its link with the service role, so it still works.
--     Links a phone signed before the photo was hidden last until they
--     expire (at most 12 hours).
--   * host_reports_select_host: the event's host (still its creator) reads
--     the reports sent to them. Nobody can add, change or remove rows from
--     the app; the triggers and resolve_host_report do that.
--
--   Report emails (replaces two things from report-email.sql)
--   * claim_report_emails and the 'report-email' cron job only take reports
--     with route 'support' or a serious reason. A host report about spam,
--     impersonation or "something else" isn't emailed; it's still in the
--     reports table for the dashboard.
--
--   Push
--   * push_outbox kind 'hostReport' added. The phone has no setting for it,
--     so it's always on.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ROUTE COLUMN
-- ----------------------------------------------------------------------------
alter table public.reports add column if not exists route text not null default 'support';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'reports_route_check' and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_route_check check (route in ('support', 'host'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 1b. CHILD SAFETY REASON
-- ----------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in (
  'spam', 'harassment', 'hate', 'nudity', 'violence', 'impersonation', 'child_safety', 'other'
));


-- ----------------------------------------------------------------------------
-- 2. SERIOUS REASONS
-- Keep in step with SUPPORT_ALWAYS in src/lib/reportRoute.ts.
-- ----------------------------------------------------------------------------
create or replace function private.report_is_serious(p_reason text)
returns boolean language sql immutable set search_path = '' as $$
  select p_reason in ('harassment', 'hate', 'nudity', 'violence', 'child_safety');
$$;

revoke execute on function private.report_is_serious(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. THE HOST'S COPY
-- ----------------------------------------------------------------------------
create table if not exists public.host_reports (
  -- The same id as the reports row.
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  -- No foreign key: the decision is kept after the photo is deleted.
  photo_id uuid not null,
  uploader_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'photo' check (kind in ('photo', 'video')),
  reason text not null,
  details text check (details is null or char_length(details) <= 1000),
  -- RollCal support was told too (a serious reason).
  also_support boolean not null default false,
  decision text check (decision in ('kept', 'deleted')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.host_reports drop constraint if exists host_reports_reason_check;
alter table public.host_reports add constraint host_reports_reason_check check (reason in (
  'spam', 'harassment', 'hate', 'nudity', 'violence', 'impersonation', 'child_safety', 'other'
));
create index if not exists host_reports_host_idx on public.host_reports (host_id, decided_at);
create index if not exists host_reports_photo_idx on public.host_reports (photo_id);

alter table public.host_reports enable row level security;

drop policy if exists "host_reports_select_host" on public.host_reports;
create policy "host_reports_select_host" on public.host_reports
  for select to authenticated
  using (host_id = (select auth.uid()) and private.is_leader(event_id, (select auth.uid())));

revoke insert, update, delete, truncate on public.host_reports from anon, authenticated;
revoke all on public.host_reports from anon;
grant select on public.host_reports to authenticated;


-- ----------------------------------------------------------------------------
-- 3b. HIDDEN PHOTOS (kept for support)
-- ----------------------------------------------------------------------------
alter table public.photos add column if not exists hidden_at timestamptz;
create index if not exists photos_hidden_path_idx on public.photos (storage_path) where hidden_at is not null;

create or replace function private.photo_file_held(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.photos where storage_path = p_name and hidden_at is not null
  );
$$;

revoke execute on function private.photo_file_held(text) from public, anon;
grant execute on function private.photo_file_held(text) to authenticated, service_role;

drop policy if exists "photos_select_member" on public.photos;
create policy "photos_select_member" on public.photos
  for select to authenticated
  using (hidden_at is null and private.is_member(event_id, auth.uid()));

drop policy if exists "event_photos_read_member" on storage.objects;
create policy "event_photos_read_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-photos'
    and private.is_member(((storage.foldername(name))[1])::uuid, auth.uid())
    and not private.photo_file_held(name)
  );

drop policy if exists "event_photos_delete_owner_or_leader" on storage.objects;
create policy "event_photos_delete_owner_or_leader" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-photos'
    and (
      owner = auth.uid()
      or private.is_leader(((storage.foldername(name))[1])::uuid, auth.uid())
    )
    and not private.photo_file_held(name)
  );


-- ----------------------------------------------------------------------------
-- 4. PUSH KIND
-- ----------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.push_outbox'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.push_outbox drop constraint %I', c);
  end loop;
end $$;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen', 'joinRequest', 'joinApproved',
  'eventDeleting', 'hostReport'
));


-- ----------------------------------------------------------------------------
-- 5. WHERE A REPORT GOES
-- ----------------------------------------------------------------------------
create or replace function private.reports_route()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ph record;
begin
  if new.route is distinct from 'host' or new.target_type <> 'photo' then
    new.route := 'support';
    return new;
  end if;
  select p.event_id, p.uploader_id, e.creator_id
    into ph
    from public.photos p
    join public.events e on e.id = p.event_id
   where p.id = new.target_id;
  if ph.event_id is null
     or ph.creator_id is null
     or ph.creator_id = new.reporter_id
     or ph.uploader_id is not distinct from ph.creator_id
     or not private.is_member(ph.event_id, new.reporter_id) then
    new.route := 'support';
  end if;
  return new;
end;
$$;

revoke execute on function private.reports_route() from public, anon, authenticated;

drop trigger if exists reports_route on public.reports;
create trigger reports_route
  before insert on public.reports
  for each row execute function private.reports_route();

create or replace function private.reports_to_host()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ph record;
  waiting boolean;
  recent integer;
begin
  if new.route <> 'host' then
    return null;
  end if;
  select p.id, p.event_id, p.uploader_id, p.kind, e.creator_id, e.title
    into ph
    from public.photos p
    join public.events e on e.id = p.event_id
   where p.id = new.target_id;
  if ph.id is null then
    return null;
  end if;

  -- One at a time per host, so the checks below can't both pass at once.
  perform pg_advisory_xact_lock(hashtextextended('hostReport:' || ph.creator_id::text, 0));

  select exists (
    select 1 from public.host_reports
     where photo_id = ph.id and host_id = ph.creator_id and decision is null
  ) into waiting;
  select count(*) into recent
    from public.push_outbox
   where user_id = ph.creator_id and kind = 'hostReport'
     and created_at > now() - interval '1 hour';

  insert into public.host_reports
    (id, event_id, host_id, photo_id, uploader_id, kind, reason, details, also_support, created_at)
  values
    (new.id, ph.event_id, ph.creator_id, ph.id, ph.uploader_id, coalesce(ph.kind, 'photo'),
     new.reason, new.details, private.report_is_serious(new.reason),
     date_trunc('hour', new.created_at))
  on conflict (id) do nothing;

  if not waiting and recent < 5 then
    insert into public.push_outbox (user_id, kind, event_id, title, body, data)
    values (
      ph.creator_id, 'hostReport', ph.event_id,
      case when ph.kind = 'video' then 'Video reported' else 'Photo reported' end,
      'A ' || case when ph.kind = 'video' then 'video' else 'photo' end
        || ' in ' || ph.title || ' was reported to you. Tap to review it.',
      jsonb_build_object('type', 'hostReport', 'reportId', new.id, 'eventId', ph.event_id)
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.reports_to_host() from public, anon, authenticated;

drop trigger if exists reports_to_host on public.reports;
create trigger reports_to_host
  after insert on public.reports
  for each row execute function private.reports_to_host();


-- ----------------------------------------------------------------------------
-- 6. THE HOST'S DECISION
-- ----------------------------------------------------------------------------
create or replace function public.resolve_host_report(p_report uuid, p_decision text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.host_reports;
  ph record;
  outcome text;
  answer text;
begin
  if p_decision is null or p_decision not in ('keep', 'delete') then
    raise exception 'Choose keep or delete' using errcode = '22023';
  end if;

  select * into r from public.host_reports where id = p_report for update;
  if r.id is null
     or r.host_id is distinct from auth.uid()
     or not private.is_leader(r.event_id, auth.uid()) then
    raise exception 'Only the host can review this report' using errcode = '42501';
  end if;
  if r.decision is not null then
    return r.decision;
  end if;

  select id, hidden_at into ph
    from public.photos where id = r.photo_id and event_id = r.event_id;

  if p_decision = 'keep' and ph.id is not null and ph.hidden_at is null then
    outcome := 'kept';
    answer := 'kept';
  else
    -- Deleting, or the photo is already gone or hidden (counts as deleted).
    outcome := 'deleted';
    answer := 'deleted';
    if ph.id is not null and ph.hidden_at is null then
      if exists (select 1 from public.host_reports where photo_id = r.photo_id and also_support) then
        -- Support needs to see it: hide it, keep the row and the file.
        update public.photos set hidden_at = now() where id = ph.id;
        update public.events set cover_photo_id = null
         where id = r.event_id and cover_photo_id = ph.id;
        answer := 'hidden';
      else
        delete from public.photos where id = ph.id;
      end if;
    end if;
  end if;

  update public.host_reports
     set decision = outcome, decided_at = now()
   where photo_id = r.photo_id and host_id = r.host_id and decision is null;
  return answer;
end;
$$;

revoke execute on function public.resolve_host_report(uuid, text) from public, anon;
grant execute on function public.resolve_host_report(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. REPORT EMAILS: support reports and serious reasons only
-- Same as report-email.sql apart from the route check.
-- ----------------------------------------------------------------------------
create or replace function public.claim_report_emails(max_rows integer default 20)
returns setof public.reports
language sql security definer set search_path = public as $$
  update reports r
     set emailed_at = now()
   where r.id in (
     select id from reports
      where emailed_at is null and created_at > now() - interval '7 days'
        and (route = 'support' or private.report_is_serious(reason))
      order by created_at
      limit max_rows
      for update skip locked
   )
  returning r.*;
$$;

revoke execute on function public.claim_report_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_report_emails(integer) to service_role;

select cron.unschedule('report-email')
 where exists (select 1 from cron.job where jobname = 'report-email');

select cron.schedule(
  'report-email',
  '*/10 * * * *',
  $job$
    select public.poke_report_email()
     where exists (select 1 from public.reports
                    where emailed_at is null
                      and (route = 'support' or private.report_is_serious(reason))
                      and created_at < now() - interval '5 minutes'
                      and created_at > now() - interval '7 days');
  $job$
);
