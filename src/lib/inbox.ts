// The notifications inbox (the bell on Home): the latest message in each
// chat, plus everything else worth knowing - invitations, friend and join
// requests, new photos, bills, events about to be deleted and photos
// reported to you as host. It's built
// from the data each time rather than stored, so it's never out of step
// with what actually happened. What's been seen is kept on the phone;
// inboxArrange.ts decides what's new and what's dropped.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatDay, formatTime } from './dates';
import { arrangeInbox, markSeen, SeenMap } from './inboxArrange';
import { earliestOf } from './marks';
import { loadWaitingHostReports } from './hostReports';
import { NotificationTarget } from './notifications';
import { loadBlockedIds } from './safety';
import { loadServerMarks, saveServerMarks } from './seenMarks';
import { supabase } from './supabase';
import { getChatReadMap } from './unread';

export type InboxTarget = NotificationTarget | { kind: 'invitations' } | { kind: 'friendRequests' };

export type InboxItem = {
  key: string;
  // Chats get the chat icon; the rest show the person or a bell.
  kind:
    | 'chat'
    | 'invite'
    | 'friend'
    | 'join'
    | 'inviteRequest'
    | 'photos'
    | 'bill'
    | 'deleting'
    | 'hostReport';
  title: string;
  body: string;
  at: string;
  personId?: string;
  personName?: string;
  avatarUrl?: string | null;
  pending?: boolean;
  // Chats: when you read that chat, if it was after this message.
  readAt?: string;
  target: InboxTarget;
};

const seenKey = (userId: string) => `rollcal.inboxSeen.${userId}`;

async function getLocalSeen(userId: string): Promise<SeenMap> {
  try {
    const raw = await AsyncStorage.getItem(seenKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Seen on this phone or any other: the first time counts.
async function getSeen(userId: string): Promise<SeenMap> {
  const [local, server] = await Promise.all([getLocalSeen(userId), loadServerMarks('inbox')]);
  return earliestOf(local, server);
}

// Everything on screen now counts as seen (from now, unless it was already),
// here and on the server for your other phones.
export async function markInboxSeen(userId: string, keys: string[]): Promise<void> {
  try {
    const before = await getLocalSeen(userId);
    const next = markSeen(before, keys);
    await AsyncStorage.setItem(seenKey(userId), JSON.stringify(next));
    const fresh: SeenMap = {};
    for (const key of keys) fresh[key] = next[key];
    await saveServerMarks('inbox', fresh, true);
  } catch {
    // A lost mark only means something shows as new once more.
  }
}

type EventRow = {
  id: string;
  title: string;
  creator_id: string;
  starts_at: string;
  delete_at?: string | null;
};

const BILL_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const first = (name: string | null | undefined) => (name ?? '').split(' ')[0] || 'Someone';
const short = (text: string) => text.replace(/\s+/g, ' ').trim();

async function loadEvents(): Promise<EventRow[]> {
  const cols = 'id, title, creator_id, starts_at';
  const withDelete = await supabase.from('events').select(`${cols}, delete_at`);
  // Before event-delete.sql has run there's no delete_at column.
  if (!withDelete.error) return (withDelete.data ?? []) as EventRow[];
  const { data } = await supabase.from('events').select(cols);
  return (data ?? []) as EventRow[];
}

async function loadItems(userId: string): Promise<InboxItem[]> {
  const events = await loadEvents();
  const eventIds = events.map((e) => e.id);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const hosted = events.filter((e) => e.creator_id === userId).map((e) => e.id);
  const none = Promise.resolve({ data: [] as never[] });

  const [
    { data: messages },
    { data: photos },
    { data: invites },
    { data: friendReqs },
    { data: joinReqs },
    { data: inviteReqs },
    { data: bills },
    blocked,
    chatReads,
    hostReports,
  ] = await Promise.all([
    eventIds.length
      ? supabase
          .from('messages')
          .select('id, event_id, sender_id, body, created_at')
          .in('event_id', eventIds)
          .neq('sender_id', userId)
          .order('created_at', { ascending: false })
          .limit(300)
      : none,
    eventIds.length
      ? supabase
          .from('photos')
          .select('id, event_id, uploader_id, created_at')
          .in('event_id', eventIds)
          .neq('uploader_id', userId)
          .order('created_at', { ascending: false })
          .limit(300)
      : none,
    supabase
      .from('invitations')
      .select('id, event_id, invited_by, created_at')
      .eq('invited_user_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('friendships')
      .select('id, requester_id, created_at')
      .eq('addressee_id', userId)
      .eq('status', 'pending'),
    hosted.length
      ? supabase
          .from('event_join_requests')
          .select('id, event_id, user_id, created_at')
          .in('event_id', hosted)
      : none,
    hosted.length
      ? supabase
          .from('event_invite_requests')
          .select('id, event_id, requested_by, suggested_user_id, created_at')
          .in('event_id', hosted)
          .eq('status', 'pending')
      : none,
    eventIds.length
      ? supabase
          .from('bills')
          .select('id, event_id, created_by, created_at')
          .in('event_id', eventIds)
          .eq('status', 'open')
          .neq('created_by', userId)
          .gte('created_at', new Date(Date.now() - BILL_LOOKBACK_MS).toISOString())
      : none,
    loadBlockedIds(),
    getChatReadMap(userId),
    hosted.length ? loadWaitingHostReports(userId) : Promise.resolve([]),
  ]);

  // Invitations can be to events you can't list yet; fetch those titles.
  const missing = [...new Set((invites ?? []).map((i) => i.event_id))].filter(
    (id) => !eventById.has(id)
  );
  if (missing.length) {
    const { data } = await supabase
      .from('events')
      .select('id, title, creator_id, starts_at')
      .in('id', missing);
    for (const e of (data ?? []) as EventRow[]) eventById.set(e.id, e);
  }

  // The latest message and photo from someone else, per event.
  const latestMessage = new Map<string, NonNullable<typeof messages>[number]>();
  for (const m of messages ?? []) {
    if (blocked.has(m.sender_id) || latestMessage.has(m.event_id)) continue;
    latestMessage.set(m.event_id, m);
  }
  const latestPhoto = new Map<string, NonNullable<typeof photos>[number]>();
  for (const p of photos ?? []) {
    if (blocked.has(p.uploader_id) || latestPhoto.has(p.event_id)) continue;
    const ev = eventById.get(p.event_id);
    // A cover added before the event isn't news until the roll opens.
    if (!ev || Date.now() < new Date(ev.starts_at).getTime()) continue;
    latestPhoto.set(p.event_id, p);
  }

  const peopleIds = new Set<string>();
  latestMessage.forEach((m) => peopleIds.add(m.sender_id));
  latestPhoto.forEach((p) => peopleIds.add(p.uploader_id));
  for (const i of invites ?? []) if (i.invited_by) peopleIds.add(i.invited_by);
  for (const f of friendReqs ?? []) peopleIds.add(f.requester_id);
  for (const j of joinReqs ?? []) peopleIds.add(j.user_id);
  for (const r of inviteReqs ?? []) {
    peopleIds.add(r.requested_by);
    peopleIds.add(r.suggested_user_id);
  }
  for (const b of bills ?? []) peopleIds.add(b.created_by);
  const { data: people } = peopleIds.size
    ? await supabase
        .from('profiles')
        .select('id, display_name, first_name, avatar_url')
        .in('id', [...peopleIds])
    : { data: [] };
  const person = (id: string) => {
    const p = people?.find((x) => x.id === id);
    return {
      personId: id,
      personName: p?.first_name || first(p?.display_name),
      avatarUrl: p?.avatar_url ?? null,
    };
  };
  const titleOf = (eventId: string) => eventById.get(eventId)?.title ?? 'An event';

  const items: InboxItem[] = [];

  latestMessage.forEach((m) => {
    const who = person(m.sender_id);
    items.push({
      key: `chat:${m.event_id}:${m.id}`,
      kind: 'chat',
      title: titleOf(m.event_id),
      body: `${who.personName}: ${short(m.body)}`,
      at: m.created_at,
      ...who,
      target: { kind: 'chat', eventId: m.event_id, title: titleOf(m.event_id) },
    });
  });

  latestPhoto.forEach((p) => {
    const who = person(p.uploader_id);
    items.push({
      key: `photos:${p.event_id}:${p.id}`,
      kind: 'photos',
      title: titleOf(p.event_id),
      body: `${who.personName} added photos.`,
      at: p.created_at,
      ...who,
      target: { kind: 'event', eventId: p.event_id },
    });
  });

  for (const i of invites ?? []) {
    if (!eventById.has(i.event_id)) continue;
    const who = person(i.invited_by);
    items.push({
      key: `invite:${i.id}`,
      kind: 'invite',
      title: titleOf(i.event_id),
      body: `${who.personName} invited you.`,
      at: i.created_at,
      ...who,
      pending: true,
      target: { kind: 'invitations' },
    });
  }

  for (const f of friendReqs ?? []) {
    const who = person(f.requester_id);
    items.push({
      key: `friend:${f.id}`,
      kind: 'friend',
      title: who.personName,
      body: 'wants to be friends.',
      at: f.created_at,
      ...who,
      pending: true,
      target: { kind: 'friendRequests' },
    });
  }

  for (const j of joinReqs ?? []) {
    const who = person(j.user_id);
    items.push({
      key: `join:${j.id}`,
      kind: 'join',
      title: titleOf(j.event_id),
      body: `${who.personName} asked to join.`,
      at: j.created_at,
      ...who,
      pending: true,
      target: { kind: 'event', eventId: j.event_id },
    });
  }

  for (const r of inviteReqs ?? []) {
    const who = person(r.requested_by);
    items.push({
      key: `inviteRequest:${r.id}`,
      kind: 'inviteRequest',
      title: titleOf(r.event_id),
      body: `${who.personName} wants to invite ${person(r.suggested_user_id).personName}.`,
      at: r.created_at,
      ...who,
      pending: true,
      target: { kind: 'event', eventId: r.event_id },
    });
  }

  // A bill you've already paid (or said you paid) isn't asking anything.
  const billIds = (bills ?? []).map((b) => b.id);
  const { data: myPayments } = billIds.length
    ? await supabase.from('bill_payments').select('bill_id').eq('user_id', userId).in('bill_id', billIds)
    : { data: [] };
  const paid = new Set((myPayments ?? []).map((p) => p.bill_id));

  for (const b of bills ?? []) {
    if (paid.has(b.id)) continue;
    const who = person(b.created_by);
    items.push({
      key: `bill:${b.id}`,
      kind: 'bill',
      title: titleOf(b.event_id),
      body: `${who.personName} paid the bill. Tap to pay your part.`,
      at: b.created_at,
      ...who,
      target: { kind: 'bill', billId: b.id },
    });
  }

  for (const e of events) {
    if (!e.delete_at || e.creator_id === userId) continue;
    items.push({
      key: `deleting:${e.id}:${e.delete_at}`,
      kind: 'deleting',
      title: e.title,
      body: `This event will be deleted on ${formatDay(e.delete_at)} at ${formatTime(e.delete_at)}. Save any photos you want to keep.`,
      at: new Date(new Date(e.delete_at).getTime() - 48 * 60 * 60 * 1000).toISOString(),
      target: { kind: 'event', eventId: e.id },
    });
  }

  // Reported to you as host: no person shown, since who reported is private.
  // Waits here until you keep or delete it.
  for (const r of hostReports) {
    items.push({
      key: `hostReport:${r.photo_id}`,
      kind: 'hostReport',
      title: titleOf(r.event_id),
      body: `A ${r.kind === 'video' ? 'video' : 'photo'} was reported to you. Tap to review it.`,
      at: r.created_at,
      pending: true,
      target: { kind: 'hostReport', reportId: r.id },
    });
  }

  // A chat you've already read counts as seen from when you read it.
  for (const item of items) {
    if (item.kind !== 'chat' || item.target.kind !== 'chat') continue;
    const readAt = chatReads[item.target.eventId];
    if (readAt && readAt >= item.at) item.readAt = readAt;
  }
  return items;
}

export type Inbox = { fresh: InboxItem[]; earlier: InboxItem[] };

export async function loadInbox(userId: string): Promise<Inbox> {
  const [items, seen] = await Promise.all([loadItems(userId), getSeen(userId)]);
  const withReads: SeenMap = { ...seen };
  for (const item of items) {
    if (item.readAt && !withReads[item.key]) withReads[item.key] = item.readAt;
  }
  return arrangeInbox(items, withReads);
}
