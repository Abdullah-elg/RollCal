// Turns push_outbox rows into Expo push messages, one per phone that wants
// them. Kept free of Deno and Supabase imports so `npm test` can run it.

export type OutboxRow = {
  id: number;
  user_id: string;
  kind: string;
  event_id: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type TokenRow = {
  token: string;
  user_id: string;
  platform: string;
  // The phone's notification settings; a missing kind counts as on.
  prefs: Record<string, unknown>;
  muted_events: string[];
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: string;
  priority: 'high' | 'default';
  // Groups one event's chat messages together on iOS.
  threadId?: string;
  // The number on the app icon: what's waiting for this person.
  badge?: number;
};

// Expo takes at most 100 messages per request.
export const EXPO_BATCH = 100;

// badges: user id -> the count for their app icon (see badge_counts in
// supabase/badge.sql). People missing from it get no badge change.
export function buildMessages(
  rows: OutboxRow[],
  tokens: TokenRow[],
  badges: Record<string, number> = {}
): ExpoMessage[] {
  const byUser = new Map<string, TokenRow[]>();
  for (const t of tokens) {
    const list = byUser.get(t.user_id) ?? [];
    list.push(t);
    byUser.set(t.user_id, list);
  }

  const messages: ExpoMessage[] = [];
  for (const row of rows) {
    for (const t of byUser.get(row.user_id) ?? []) {
      if (t.prefs?.[row.kind] === false) continue;
      if (row.kind === 'chatMessage' && row.event_id && t.muted_events?.includes(row.event_id)) {
        continue;
      }
      messages.push({
        to: t.token,
        title: row.title,
        body: row.body,
        data: row.data ?? {},
        sound: 'default',
        channelId: 'default',
        priority: row.kind === 'chatMessage' ? 'high' : 'default',
        ...(row.event_id ? { threadId: row.event_id } : {}),
        ...(row.user_id in badges ? { badge: badges[row.user_id] } : {}),
      });
    }
  }
  return messages;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Tokens Expo says will never work again, from one request's tickets (which
// come back in the same order as the messages).
export function deadTokens(
  sent: ExpoMessage[],
  tickets: { status: string; details?: { error?: string } }[]
): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' && sent[i]) {
      dead.push(sent[i].to);
    }
  });
  return [...new Set(dead)];
}
