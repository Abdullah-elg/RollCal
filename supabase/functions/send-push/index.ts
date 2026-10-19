// RollCal push sender: sends what's waiting in push_outbox through Expo's
// push service (see supabase/push.sql).
//
// Called by the database whenever rows are added, and by the "push-tick"
// cron job as a retry, with the key stored in Vault in the x-push-key
// header. Nothing else can trigger it.
//
// Optional secret EXPO_ACCESS_TOKEN: set it if you turn on "Enhanced push
// security" for the project on expo.dev, so only this function can send.
//
// Deploy with "Enforce JWT verification" OFF; the key check replaces it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildMessages,
  chunk,
  deadTokens,
  EXPO_BATCH,
  type ExpoMessage,
  type OutboxRow,
  type TokenRow,
} from './messages.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Stop claiming new rows after this; the cron job picks up the rest.
const TIME_BUDGET_MS = 20_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Ticket = { status: string; details?: { error?: string } };

// One request to Expo. Returns the tickets, or none if the request failed.
async function sendBatch(messages: ExpoMessage[]): Promise<Ticket[]> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('Expo push failed', res.status, JSON.stringify(body)?.slice(0, 500));
      return [];
    }
    return (body?.data ?? []) as Ticket[];
  } catch (err) {
    console.error('Expo push request failed', err);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const key = req.headers.get('x-push-key') ?? '';
  const { data: keyOk } = await admin.rpc('push_key_ok', { key });
  if (!key || keyOk !== true) return json(401, { error: 'Not allowed' });

  const started = Date.now();
  let rowsSent = 0;
  let messagesSent = 0;
  let removed = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: claimed, error } = await admin.rpc('claim_push_outbox', { max_rows: 500 });
    if (error) return json(500, { error: error.message, rowsSent, messagesSent });
    const rows = (claimed ?? []) as OutboxRow[];
    if (rows.length === 0) break;

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: tokens, error: tokensError } = await admin
      .from('push_tokens')
      .select('token, user_id, platform, prefs, muted_events')
      .in('user_id', userIds);
    if (tokensError) return json(500, { error: tokensError.message, rowsSent, messagesSent });

    const messages = buildMessages(rows, (tokens ?? []) as TokenRow[]);
    const dead: string[] = [];
    for (const batch of chunk(messages, EXPO_BATCH)) {
      const tickets = await sendBatch(batch);
      messagesSent += tickets.filter((t) => t.status === 'ok').length;
      dead.push(...deadTokens(batch, tickets));
    }

    // Phones that uninstalled the app or turned notifications off for it.
    if (dead.length > 0) {
      const { count } = await admin
        .from('push_tokens')
        .delete({ count: 'exact' })
        .in('token', [...new Set(dead)]);
      removed += count ?? 0;
    }
    rowsSent += rows.length;
  }

  console.log(`Sent ${rowsSent} rows as ${messagesSent} messages, removed ${removed} dead tokens`);
  return json(200, { rowsSent, messagesSent, removed });
});
