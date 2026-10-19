import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { formatCents } from './money';
import { loadPhotoExpiry } from './expiry';
import { rollClosesAt } from './roll';
import { supabase } from './supabase';

// Two kinds of notification live here:
//   * Local ones scheduled on this phone: event reminders, roll reminders,
//     photo expiry warnings.
//   * Server push (supabase/push.sql): friend requests, chat messages and
//     the roll opening, sent the moment they happen even if the app is
//     closed. Once this phone has registered for push, the "check when the
//     app opens" fallbacks below stay quiet for those kinds.
//
// The catch: importing expo-notifications registers a device-push-token
// listener at load time, and Expo Go on Android has had push support
// stripped since SDK 53 - that listener throws and takes the whole app down
// on startup. So the module is loaded lazily, and never at all in that one
// environment. Everything here no-ops there; a development build (or iOS
// Expo Go) gets the real thing.

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const notificationsAvailable = !(isExpoGo && Platform.OS === 'android');

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null = null;

// The event whose chat is on screen, so its messages don't also pop up.
let activeChatEventId: string | null = null;
export function setActiveChat(eventId: string | null) {
  activeChatEventId = eventId;
}

function getNotifications(): NotificationsModule | null {
  if (!notificationsAvailable) return null;
  if (!cached) {
    cached = require('expo-notifications') as NotificationsModule;
    // Show banners even while the app is foregrounded, except for the chat
    // already open.
    cached.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data as { type?: unknown; eventId?: unknown };
        const hide = data?.type === 'chat' && data.eventId === activeChatEventId;
        return {
          shouldShowBanner: !hide,
          shouldShowList: !hide,
          shouldPlaySound: !hide,
          shouldSetBadge: false,
        };
      },
    });
  }
  return cached;
}

export type ReminderPrefs = {
  // Event reminders, relative to starts_at.
  dayBefore: boolean;
  hourBefore: boolean;
  thirtyMin: boolean;
  fiveMin: boolean;
  atStart: boolean;
  // Album reminders, relative to the upload window (ends_at → +48h).
  albumOpen: boolean;
  albumDayLeft: boolean;
  albumHourLeft: boolean;
  albumClosed: boolean;
  // A week and a day before a free event's photos are deleted.
  photosExpiring: boolean;
  // Friend activity. Unlike the two groups above, these can't be scheduled
  // ahead of time - they're things other people do - so they're delivered
  // when the app next loads your friend data. See notifyFriendActivity.
  friendRequest: boolean;
  friendAccepted: boolean;
  eventInvite: boolean;
  // Bills: a new one to pay your part of, someone saying they've paid you,
  // your payment received, and reminders.
  billShared: boolean;
  // Chat. Individual events can also be muted from inside their chat.
  chatMessage: boolean;
};

const DEFAULT_PREFS: ReminderPrefs = {
  dayBefore: false,
  hourBefore: false,
  thirtyMin: true,
  fiveMin: false,
  atStart: false,
  // The album opening is the whole point of the app - on by default.
  albumOpen: true,
  albumDayLeft: false,
  albumHourLeft: false,
  albumClosed: false,
  photosExpiring: true,
  friendRequest: true,
  friendAccepted: true,
  eventInvite: true,
  billShared: true,
  chatMessage: true,
};

export const EVENT_PREF_KEYS = [
  'dayBefore',
  'hourBefore',
  'thirtyMin',
  'fiveMin',
  'atStart',
] as const;

export const ALBUM_PREF_KEYS = [
  'albumOpen',
  'albumDayLeft',
  'albumHourLeft',
  'albumClosed',
  'photosExpiring',
] as const;

export const FRIEND_PREF_KEYS = [
  'friendRequest',
  'friendAccepted',
  'eventInvite',
  'billShared',
] as const;

export const CHAT_PREF_KEYS = ['chatMessage'] as const;

const PREFS_KEY = 'socialink.reminderPrefs';

export async function getReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setReminderPrefs(prefs: ReminderPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  // The server needs to know which kinds this phone wants pushed.
  syncPushSettings();
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }
  return false;
}

async function ensureAndroidChannel(Notifications: NotificationsModule) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

// Recompute the full schedule from current prefs + events. Cancel-all then
// reschedule keeps it idempotent - safe to call after any change, and stale
// reminders for deleted or moved events disappear on their own.
export async function syncEventReminders(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureAndroidChannel(Notifications);

    const prefs = await getReminderPrefs();
    await Notifications.cancelAllScheduledNotificationsAsync();

    const { data: events } = await supabase.from('events').select('*');
    if (!events) return;

    // Photos on free events are deleted after 30 days; warn a week and a
    // day ahead. The host's notice also mentions Pro, which would keep them.
    const expiry = prefs.photosExpiring ? await loadPhotoExpiry(events.map((e) => e.id)) : {};
    const { data: auth } = await supabase.auth.getSession();
    const me = auth.session?.user.id;

    // With push, the server announces the roll opening instead.
    const pushed = me ? await serverPushActive(me) : false;

    const now = Date.now();
    const planned: { at: number; title: string; body: string }[] = [];
    const plan = (at: number, title: string, body: string) => {
      if (at > now) planned.push({ at, title, body });
    };

    const MIN = 60 * 1000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;

    for (const e of events) {
      const starts = new Date(e.starts_at).getTime();
      const ends = new Date(e.ends_at).getTime();
      const closes = rollClosesAt(e);

      if (prefs.dayBefore) plan(starts - DAY, e.title, 'Happening tomorrow.');
      if (prefs.hourBefore) plan(starts - HOUR, e.title, 'Starts in an hour.');
      if (prefs.thirtyMin) plan(starts - 30 * MIN, e.title, 'Starts in 30 minutes.');
      if (prefs.fiveMin) plan(starts - 5 * MIN, e.title, 'Starts in 5 minutes.');
      if (prefs.atStart) plan(starts, e.title, 'Starting now.');

      if (prefs.albumOpen && !pushed) {
        plan(ends, e.title, 'The roll is open - add your photos.');
      }
      if (prefs.albumDayLeft) {
        plan(closes - DAY, e.title, 'One day left to add photos to the roll.');
      }
      if (prefs.albumHourLeft) {
        plan(closes - HOUR, e.title, 'Last hour to add photos to the roll.');
      }
      if (prefs.albumClosed) {
        plan(closes, e.title, 'The roll is closed. Save the photos you want to keep.');
      }

      const expiresAt = expiry[e.id]?.expiresAt;
      if (expiresAt && !expiry[e.id]?.expiredAt) {
        const at = new Date(expiresAt).getTime();
        const proNote = e.creator_id === me ? ' Get Pro to keep them for good.' : '';
        plan(at - 7 * DAY, e.title, `The photos will be deleted in a week. Save the ones you want.${proNote}`);
        plan(at - DAY, e.title, `The photos will be deleted tomorrow. Save the ones you want.${proNote}`);
      }
    }

    // iOS caps pending local notifications (64), so keep the soonest ones.
    planned.sort((a, b) => a.at - b.at);
    await Promise.all(
      planned.slice(0, 60).map((p) =>
        Notifications.scheduleNotificationAsync({
          content: { title: p.title, body: p.body },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(p.at),
          },
        })
      )
    );
  } catch (err) {
    console.warn('Reminder sync failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Friend activity
//
// Event and album reminders can be scheduled in advance because their timing
// is known. Friend activity can't: it happens on someone else's phone. With
// no push server in the mix, the honest thing this app can do is check for
// anything new each time it loads your friend data (app launch, opening the
// Friends tab, pull to refresh) and raise a notification then.
//
// What's already been announced is remembered per user, so nothing repeats.
// ---------------------------------------------------------------------------

type FriendSnapshot = {
  friends: { friendshipId: string; profile: { display_name: string } }[];
  incoming: { friendshipId: string; profile: { display_name: string } }[];
  outgoing: { friendshipId: string }[];
};

type FriendNotifyState = {
  // Requests we've already announced.
  announcedIncoming: string[];
  // Acceptances we've already announced.
  announcedAccepted: string[];
  // Requests that were still pending last time, so we can spot the ones the
  // other person has since accepted.
  pendingOutgoing: string[];
};

const friendStateKey = (userId: string) => `socialink.friendNotify.${userId}`;

export async function notifyFriendActivity(
  userId: string,
  data: FriendSnapshot
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    const prefs = await getReminderPrefs();
    if (!prefs.friendRequest && !prefs.friendAccepted) return;

    const key = friendStateKey(userId);
    const raw = await AsyncStorage.getItem(key);
    const nextState: FriendNotifyState = {
      announcedIncoming: data.incoming.map((l) => l.friendshipId),
      announcedAccepted: data.friends.map((l) => l.friendshipId),
      pendingOutgoing: data.outgoing.map((l) => l.friendshipId),
    };

    // First run on this account: record where things stand without
    // announcing a backlog.
    if (!raw) {
      await AsyncStorage.setItem(key, JSON.stringify(nextState));
      return;
    }

    const prev: FriendNotifyState = {
      announcedIncoming: [],
      announcedAccepted: [],
      pendingOutgoing: [],
      ...JSON.parse(raw),
    };

    const messages: { title: string; body: string }[] = [];

    if (prefs.friendRequest) {
      for (const link of data.incoming) {
        if (!prev.announcedIncoming.includes(link.friendshipId)) {
          messages.push({
            title: link.profile.display_name,
            body: 'wants to be friends.',
          });
        }
      }
    }

    if (prefs.friendAccepted) {
      for (const link of data.friends) {
        // It counts as "they accepted mine" only if this pair was one of my
        // pending requests the last time we looked.
        if (
          prev.pendingOutgoing.includes(link.friendshipId) &&
          !prev.announcedAccepted.includes(link.friendshipId)
        ) {
          messages.push({
            title: link.profile.display_name,
            body: 'accepted your friend request.',
          });
        }
      }
    }

    await AsyncStorage.setItem(key, JSON.stringify(nextState));
    // Already pushed by the server when it happened.
    if (await serverPushActive(userId)) return;

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted || messages.length === 0) return;
    await ensureAndroidChannel(Notifications);
    // A null trigger presents straight away.
    await Promise.all(
      messages.slice(0, 5).map((m) =>
        Notifications.scheduleNotificationAsync({
          content: { title: m.title, body: m.body },
          trigger: null,
        })
      )
    );
  } catch (err) {
    console.warn('Friend notification check failed:', err);
  }
}

// Direct event invitations, announced the same way: spotted when the app
// next loads them, and only once each.
type InviteSnapshot = {
  invitation: { id: string };
  event: { title: string };
  hostName: string;
}[];

const inviteStateKey = (userId: string) => `socialink.inviteNotify.${userId}`;

export async function notifyEventInvitations(
  userId: string,
  pending: InviteSnapshot
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    const prefs = await getReminderPrefs();
    if (!prefs.eventInvite) return;

    const key = inviteStateKey(userId);
    const raw = await AsyncStorage.getItem(key);
    const currentIds = pending.map((p) => p.invitation.id);

    // First run on this account: note what's already there, announce nothing.
    if (!raw) {
      await AsyncStorage.setItem(key, JSON.stringify(currentIds));
      return;
    }

    const announced: string[] = JSON.parse(raw);
    const fresh = pending.filter((p) => !announced.includes(p.invitation.id));
    await AsyncStorage.setItem(key, JSON.stringify(currentIds));

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted || fresh.length === 0) return;
    await ensureAndroidChannel(Notifications);
    await Promise.all(
      fresh.slice(0, 5).map((p) =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: p.event.title,
            body: `${p.hostName} invited you.`,
          },
          trigger: null,
        })
      )
    );
  } catch (err) {
    console.warn('Invitation notification check failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Chat
//
// Same story as friend activity: messages arrive from other people, so they
// are picked up when the app next loads your events. Individual events can
// be muted from inside their chat, which is stored on the device.
// ---------------------------------------------------------------------------

const mutedChatsKey = (userId: string) => `socialink.chatMuted.${userId}`;
const chatSeenKey = (userId: string) => `socialink.chatSeen.${userId}`;

export async function getMutedChats(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(mutedChatsKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function setChatMuted(
  userId: string,
  eventId: string,
  muted: boolean
): Promise<void> {
  const current = await getMutedChats(userId);
  const next = muted
    ? [...new Set([...current, eventId])]
    : current.filter((id) => id !== eventId);
  await AsyncStorage.setItem(mutedChatsKey(userId), JSON.stringify(next));
  syncPushSettings();
}

// Messages already read on screen shouldn't come back as notifications, so
// the chat screen moves this watermark forward as it displays them.
export async function markChatSeen(timestamp: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(chatSeenKey('shared'));
    if (!raw || timestamp > raw) {
      await AsyncStorage.setItem(chatSeenKey('shared'), timestamp);
    }
  } catch {
    // Losing a watermark only risks one duplicate notification.
  }
}

export async function notifyChatMessages(
  userId: string,
  events: { id: string; title: string }[]
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || events.length === 0) return;
  try {
    const prefs = await getReminderPrefs();
    if (!prefs.chatMessage) return;

    const key = chatSeenKey('shared');
    const since = await AsyncStorage.getItem(key);
    const now = new Date().toISOString();

    // First run: start the clock, announce nothing from before.
    if (!since) {
      await AsyncStorage.setItem(key, now);
      return;
    }

    // Already pushed by the server when each message was sent.
    if (await serverPushActive(userId)) {
      await AsyncStorage.setItem(key, now);
      return;
    }

    const muted = await getMutedChats(userId);
    const watched = events.filter((e) => !muted.includes(e.id));
    if (watched.length === 0) {
      await AsyncStorage.setItem(key, now);
      return;
    }

    const { data: fresh } = await supabase
      .from('messages')
      .select('event_id, sender_id, body, created_at')
      .in(
        'event_id',
        watched.map((e) => e.id)
      )
      .gt('created_at', since)
      .neq('sender_id', userId)
      .order('created_at', { ascending: true })
      .limit(20);

    await AsyncStorage.setItem(key, now);
    if (!fresh || fresh.length === 0) return;

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureAndroidChannel(Notifications);

    const names = await (async () => {
      const ids = [...new Set(fresh.map((m) => m.sender_id))];
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', ids);
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.id] = row.display_name;
      return map;
    })();

    // One notification per event, carrying its newest message.
    const latestPerEvent = new Map<string, (typeof fresh)[number]>();
    for (const m of fresh) latestPerEvent.set(m.event_id, m);

    await Promise.all(
      [...latestPerEvent.values()].slice(0, 5).map((m) => {
        const title = watched.find((e) => e.id === m.event_id)?.title ?? 'Event chat';
        const who = names[m.sender_id] ?? 'Someone';
        return Notifications.scheduleNotificationAsync({
          content: { title, body: `${who}: ${m.body}` },
          trigger: null,
        });
      })
    );
  } catch (err) {
    console.warn('Chat notification check failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Bills
//
// When someone in one of your events shares a bill, you hear about it the
// next time the app loads your events, once per bill. Tapping it opens the
// bill (see onNotificationTap).
// ---------------------------------------------------------------------------

const billStateKey = (userId: string) => `socialink.billNotify.${userId}`;

export async function notifyBillsShared(
  userId: string,
  events: { id: string; title: string }[]
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || events.length === 0) return;
  try {
    const prefs = await getReminderPrefs();
    if (!prefs.billShared) return;

    const { data: bills } = await supabase
      .from('bills')
      .select('id, event_id, created_by')
      .in(
        'event_id',
        events.map((e) => e.id)
      )
      .eq('status', 'open')
      .neq('created_by', userId);

    const key = billStateKey(userId);
    const raw = await AsyncStorage.getItem(key);
    const openIds = (bills ?? []).map((b) => b.id);
    const announced: string[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(key, JSON.stringify([...new Set([...announced, ...openIds])]));
    // First run on this account: note what's already there, announce nothing.
    if (!raw) return;

    const fresh = (bills ?? []).filter((b) => !announced.includes(b.id));
    if (fresh.length === 0) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureAndroidChannel(Notifications);

    const { data: people } = await supabase
      .from('profiles')
      .select('id, display_name, first_name')
      .in('id', [...new Set(fresh.map((b) => b.created_by))]);

    await Promise.all(
      fresh.slice(0, 5).map((b) => {
        const person = people?.find((p) => p.id === b.created_by);
        const who = person?.first_name || person?.display_name || 'Someone';
        return Notifications.scheduleNotificationAsync({
          content: {
            title: events.find((e) => e.id === b.event_id)?.title ?? 'New bill',
            body: `${who} paid the bill. Tap to pay your part.`,
            data: { billId: b.id },
          },
          trigger: null,
        });
      })
    );
  } catch (err) {
    console.warn('Bill notification check failed:', err);
  }
}

// What happened on bills since this phone last looked: someone says they've
// paid you, the person you paid got it, or a bill's creator sent a reminder.
// Like notifyBillsShared, the first run on an account only takes note.
type BillPayState = {
  sent: string[];
  received: string[];
  reminded: Record<string, string>;
};

const billPayKey = (userId: string) => `socialink.billPay.${userId}`;

export async function notifyBillPayments(
  userId: string,
  events: { id: string; title: string }[]
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || events.length === 0) return;
  try {
    const prefs = await getReminderPrefs();
    if (!prefs.billShared) return;

    const paymentColumns =
      'id, user_id, amount_cents, bill_id, bills!inner(title, created_by, currency)';
    const [{ data: toMe }, { data: mine }, { data: reminders }] = await Promise.all([
      supabase
        .from('bill_payments')
        .select(paymentColumns)
        .eq('bills.created_by', userId)
        .neq('user_id', userId)
        .eq('status', 'sent'),
      supabase
        .from('bill_payments')
        .select(paymentColumns)
        .eq('user_id', userId)
        .neq('bills.created_by', userId)
        .eq('status', 'received'),
      supabase
        .from('bills')
        .select('id, title, created_by, last_reminded_at')
        .in(
          'event_id',
          events.map((e) => e.id)
        )
        .eq('status', 'open')
        .neq('created_by', userId)
        .not('last_reminded_at', 'is', null),
    ]);
    type PaymentRow = {
      id: string;
      user_id: string;
      amount_cents: number;
      bill_id: string;
      bills: { title: string | null; created_by: string; currency: string };
    };
    const sentToMe = (toMe ?? []) as unknown as PaymentRow[];
    const receivedFromMe = (mine ?? []) as unknown as PaymentRow[];

    const key = billPayKey(userId);
    const raw = await AsyncStorage.getItem(key);
    // Defaults first: state saved by an older version may lack some fields.
    const seen: BillPayState = { sent: [], received: [], reminded: {}, ...(raw ? JSON.parse(raw) : {}) };
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        sent: [...new Set([...seen.sent, ...sentToMe.map((p) => p.id)])],
        received: [...new Set([...seen.received, ...receivedFromMe.map((p) => p.id)])],
        reminded: {
          ...seen.reminded,
          ...Object.fromEntries((reminders ?? []).map((b) => [b.id, b.last_reminded_at])),
        },
      } satisfies BillPayState)
    );
    if (!raw) return;

    // whoId is the person the notification names.
    const messages: { billId: string; title: string; whoId: string; body: (who: string) => string }[] = [];
    for (const p of sentToMe.filter((p) => !seen.sent.includes(p.id))) {
      const amount = formatCents(p.amount_cents, p.bills.currency);
      messages.push({
        billId: p.bill_id,
        title: p.bills.title || 'Bill',
        whoId: p.user_id,
        body: (who) => `${who} says they sent you ${amount}. Tap to mark it received.`,
      });
    }
    for (const p of receivedFromMe.filter((p) => !seen.received.includes(p.id))) {
      const amount = formatCents(p.amount_cents, p.bills.currency);
      messages.push({
        billId: p.bill_id,
        title: p.bills.title || 'Bill',
        whoId: p.bills.created_by,
        body: (who) => `${who} got your ${amount}.`,
      });
    }
    for (const b of reminders ?? []) {
      if (b.last_reminded_at === seen.reminded[b.id]) continue;
      const title = b.title || 'the bill';
      messages.push({
        billId: b.id,
        title: b.title || 'Bill',
        whoId: b.created_by,
        body: (who) => `${who} sent a reminder about ${title}. Tap to pay your part.`,
      });
    }
    if (messages.length === 0) return;

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await ensureAndroidChannel(Notifications);
    const { data: people } = await supabase
      .from('profiles')
      .select('id, display_name, first_name')
      .in('id', [...new Set(messages.map((m) => m.whoId))]);

    await Promise.all(
      messages.slice(0, 5).map((m) => {
        const person = people?.find((p) => p.id === m.whoId);
        const who = person?.first_name || person?.display_name || 'Someone';
        return Notifications.scheduleNotificationAsync({
          content: { title: m.title, body: m.body(who), data: { billId: m.billId } },
          trigger: null,
        });
      })
    );
  } catch (err) {
    console.warn('Bill payment check failed:', err);
  }
}

// Where a tapped notification should take you.
export type NotificationTarget =
  | { kind: 'bill'; billId: string }
  | { kind: 'chat'; eventId: string; title: string }
  | { kind: 'event'; eventId: string }
  | { kind: 'friends' };

export function targetOf(data: unknown): NotificationTarget | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.billId === 'string') return { kind: 'bill', billId: d.billId };
  if (d.type === 'chat' && typeof d.eventId === 'string') {
    return { kind: 'chat', eventId: d.eventId, title: typeof d.title === 'string' ? d.title : '' };
  }
  if (d.type === 'event' && typeof d.eventId === 'string') return { kind: 'event', eventId: d.eventId };
  if (d.type === 'friends') return { kind: 'friends' };
  return null;
}

// Calls back when someone taps a notification, including the one that
// launched the app. Returns an unsubscribe.
export function onNotificationTap(open: (target: NotificationTarget) => void): () => void {
  const Notifications = getNotifications();
  if (!Notifications) return () => {};
  const handle = (response: { notification: { request: { content: { data?: unknown } } } }) => {
    const target = targetOf(response.notification.request.content.data);
    if (target) open(target);
  };
  Notifications.getLastNotificationResponseAsync()
    .then((last) => last && handle(last))
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

// ---------------------------------------------------------------------------
// Server push
//
// The phone gets an Expo push token and hands it to the server with its
// notification settings and muted chats (register_push_token). That needs
// the EAS project id from `eas init`; until there is one this does nothing
// and the "check when the app opens" fallbacks above carry on as before.
// ---------------------------------------------------------------------------

// The kinds the server sends; each phone can turn them off in Settings.
const PUSH_KINDS = ['friendRequest', 'friendAccepted', 'chatMessage', 'albumOpen'] as const;
const PUSH_TOKEN_KEY = 'rollcal.pushToken';
const PUSH_ASKED_KEY = 'rollcal.pushAsked';

type StoredPush = { userId: string; token: string };

async function storedPush(): Promise<StoredPush | null> {
  try {
    const raw = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredPush) : null;
  } catch {
    return null;
  }
}

function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

// Whether the server is pushing to this phone for this person.
export async function serverPushActive(userId: string): Promise<boolean> {
  return (await storedPush())?.userId === userId;
}

async function sendPushSettings(userId: string, token: string): Promise<void> {
  const prefs = await getReminderPrefs();
  const muted = await getMutedChats(userId);
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    p_prefs: Object.fromEntries(PUSH_KINDS.map((k) => [k, prefs[k]])),
    p_muted: muted,
  });
  if (error) {
    console.warn('Push registration failed:', error.message);
    return;
  }
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, JSON.stringify({ userId, token } satisfies StoredPush));
}

// Gets this phone's push token and registers it for the signed-in person.
// Asks for permission the first time only; after that, Settings does.
export async function registerForPush(userId: string): Promise<void> {
  const Notifications = getNotifications();
  const projectId = easProjectId();
  if (!Notifications || !projectId) return;
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain && !(await AsyncStorage.getItem(PUSH_ASKED_KEY))) {
      await AsyncStorage.setItem(PUSH_ASKED_KEY, '1');
      perm = await Notifications.requestPermissionsAsync();
    }
    if (!perm.granted) return;
    // Android needs the channel before a token can be issued.
    await ensureAndroidChannel(Notifications);
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await sendPushSettings(userId, token);
  } catch (err) {
    // Simulators and phones without Google Play services can't get a token.
    console.warn('Push token unavailable:', err);
  }
}

// Re-sends this phone's settings after they change.
export async function syncPushSettings(): Promise<void> {
  const stored = await storedPush();
  if (stored) await sendPushSettings(stored.userId, stored.token).catch(() => {});
}

// Re-registers if the system hands the app a new token. Returns an unsubscribe.
export function onPushTokenChange(userId: string): () => void {
  const Notifications = getNotifications();
  if (!Notifications || !easProjectId()) return () => {};
  const sub = Notifications.addPushTokenListener(() => {
    registerForPush(userId);
  });
  return () => sub.remove();
}

// Before signing out, so this phone stops getting the person's messages.
export async function unregisterPush(): Promise<void> {
  const stored = await storedPush();
  if (!stored) return;
  await supabase.rpc('unregister_push_token', { p_token: stored.token }).then(
    () => {},
    () => {}
  );
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}
