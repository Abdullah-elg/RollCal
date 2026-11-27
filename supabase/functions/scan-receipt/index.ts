// RollCal "Scan a receipt": a photo in, a bill draft out.
//
// Called from the bill review screen with the signed-in user's JWT:
//   supabase.functions.invoke('scan-receipt', { body: { image, mimeType } })
// where image is the photo as base64. Nothing is stored: the photo goes to
// Gemini, the answer is checked and turned into whole cents, and the draft
// comes back for the person to check before they share it.
//
// Plus and Pro scan as much as they like; free accounts get two scans a
// month that read a receipt, and six tries in all (receipt_scans_left() in
// plans.sql sets the numbers). Every photo the model reads is a try, receipt
// or not, so the allowance can't be used to read other things for free. The
// scan is claimed before the photo is read (claim_receipt_scan() in
// plans.sql), so many requests at once can't all get through on the last
// free try. A scan that fails on our side (a bad request, the model is down
// or its answer can't be read) is given back; one that reads a receipt is
// marked succeeded.
//
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional, to switch
// the first-choice model without a code change).
// Deploy with "Enforce JWT verification" ON.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { type Scan, toDraft } from './draft.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
// Tried in order. A model that's overloaded (Google answers 503 when a new
// one is in heavy demand), rate-limited or slow hands over to the next.
// gemini-3.8-flash was the newest when this was written but kept timing out
// under launch demand; set GEMINI_MODEL to try it again later.
const MODELS = [
  Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
];
const BUSY = new Set([429, 500, 503]);
// A model that hasn't answered by then is treated as busy too.
const MODEL_TIMEOUT_MS = 20_000;

// Phone photos at the app's quality setting are 1-3 MB; base64 adds a third.
const MAX_IMAGE_CHARS = 8_000_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// What Gemini is asked to return. It copies lines exactly as printed,
// discounts included; draft.ts does the arithmetic.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_receipt: { type: 'BOOLEAN' },
    merchant: { type: 'STRING', nullable: true },
    currency: { type: 'STRING', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'INTEGER' },
          line_total: { type: 'STRING' },
        },
        required: ['name', 'quantity', 'line_total'],
      },
    },
    subtotal: { type: 'STRING', nullable: true },
    tax: { type: 'STRING', nullable: true },
    tip: { type: 'STRING', nullable: true },
    fees: { type: 'STRING', nullable: true },
    total: { type: 'STRING', nullable: true },
  },
  required: ['is_receipt', 'items'],
};

const PROMPT = `Read this receipt photo and return its contents as JSON.

- is_receipt: false if the photo isn't a receipt or bill you can read.
- merchant: the restaurant or shop name, short, written the way the business writes it in normal text (Pizzeria Libretto, not PIZZERIA LIBRETTO).
- currency: the ISO 4217 code the amounts are in. Use a printed code or symbol (EUR for €). For a plain $, work it out from the receipt: the store's address or country, tax names (HST, GST, PST or QST mean CAD; a US state sales tax means USD), phone numbers, language and spelling. null only if there is no clue at all.
- items: one entry per printed line, in printed order, including discount, coupon and comp lines. name is the line as printed, cleaned up to read naturally (normal capitalization, no item codes). quantity is the printed quantity, 1 if none. line_total is the amount printed for the whole line (quantity included), like "14.00". Give discount, coupon and comp lines a minus sign, like "-2.00". Don't list tax, tip, fees, subtotals, totals or payments as items.
- subtotal: the printed subtotal before tax, if any.
- tax: all tax lines added together (for example GST plus PST), if any.
- tip: a printed tip or gratuity, if any. Don't invent one.
- fees: service charges, delivery or other fees added together, if any.
- total: the printed grand total, if any.
Write every amount as printed digits with a decimal point, without currency symbols. Use null when something isn't printed.`;

// The user id from a signed-in user's token. The gateway has already checked
// the token's signature (JWT verification is on), and the database checks it
// again when the scan is claimed below, so this skips a round trip to Auth, which
// was taking up to 40 seconds.
function userIdFrom(authorization: string): string | null {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!GEMINI_API_KEY) return json(500, { error: 'Scanning isn’t set up yet.' });

  const started = Date.now();
  const step = (what: string) => console.log(`${what} after ${Date.now() - started}ms`);
  const authorization = req.headers.get('authorization') ?? '';
  const userId = userIdFrom(authorization);
  if (!userId) return json(401, { error: 'Not signed in' });

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  // Takes one free scan now, before the slow part, so requests sent at the
  // same time can't all use the last one. scans_left is what's left after
  // this one, or null for Pro (no limit, nothing recorded). Asked as the
  // user, so the database also checks their token here.
  const { data: claim, error: claimError } = await supabase.rpc('claim_receipt_scan').single();
  step('claimed a scan');
  if (claimError || !claim) return json(401, { error: 'Not signed in' });
  const { allowed, scan_id: scanId, scans_left: left } = claim as {
    allowed: boolean;
    scan_id: number | null;
    scans_left: number | null;
  };
  if (!allowed) {
    return json(403, {
      error: 'You’ve used your free scans this month. Get Pro to scan as many as you like.',
      code: 'scan_limit',
    });
  }

  // Gives the claimed scan back when we stop before the photo was read.
  // People can't write receipt_scans themselves, so it's removed here.
  const release = async () => {
    if (scanId === null) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await admin
      .from('receipt_scans')
      .delete()
      .eq('id', scanId)
      .eq('user_id', userId);
    if (error) console.error('Could not give the scan back', error.message);
  };
  // Marks the claimed scan as one that read a receipt; only those use up the
  // free scans (the rest only use a try).
  const markSucceeded = async () => {
    if (scanId === null) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await admin
      .from('receipt_scans')
      .update({ succeeded: true })
      .eq('id', scanId)
      .eq('user_id', userId);
    if (error) console.error('Could not mark the scan as read', error.message);
  };
  const notCounted = async (status: number, body: unknown) => {
    await release();
    return json(status, body);
  };
  const unreadable = { error: 'Couldn’t read the receipt right now. Try again, or type it in.' };

  let body: { image?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return notCounted(400, { error: 'Send the photo as JSON.' });
  }
  const image = typeof body.image === 'string' ? body.image : '';
  const mimeType =
    typeof body.mimeType === 'string' && /^image\/(jpeg|png|webp|heic|heif)$/.test(body.mimeType)
      ? body.mimeType
      : 'image/jpeg';
  if (!image) return notCounted(400, { error: 'No photo was sent.' });
  if (image.length > MAX_IMAGE_CHARS) return notCounted(413, { error: 'That photo is too large.' });
  step(`photo received (${image.length} chars)`);

  const request = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: PROMPT }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: SCHEMA,
      temperature: 0,
      // Copying a receipt needs no deliberation; thinking only adds wait.
      thinking_config: { thinking_level: 'low' },
    },
  });
  let res: Response | null = null;
  let failure = '';
  for (const model of [...new Set(MODELS)]) {
    step(`asking ${model}`);
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: request,
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
    } catch (err) {
      res = null;
      failure = `${model} didn't answer in time: ${err}`;
      console.warn(failure);
      continue;
    }
    step(`${model} answered ${res.status}`);
    if (res.ok) break;
    failure = `${model} ${res.status}: ${await res.text().catch(() => '')}`;
    if (!BUSY.has(res.status)) break;
    console.warn(failure);
  }
  if (!res?.ok) {
    console.error('Gemini error', failure);
    return notCounted(502, unreadable);
  }

  type Answer = { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  let answer: Answer | null = null;
  let scan: Scan;
  let draft: ReturnType<typeof toDraft>;
  try {
    answer = (await res.json()) as Answer;
    step('read the answer');
    const text = answer?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    scan = JSON.parse(text ?? '');
    draft = toDraft(scan);
  } catch {
    console.error('Unreadable Gemini answer', JSON.stringify(answer ?? null).slice(0, 2000));
    return notCounted(502, unreadable);
  }

  // The photo was read, so the claimed scan is a try, receipt or not. It
  // isn't one of the free scans, so the count is asked for again.
  if (!scan.is_receipt || draft.items.length === 0) {
    let after = left;
    if (left !== null) {
      const { data, error } = await supabase.rpc('receipt_scans_left');
      if (!error && typeof data === 'number') after = data;
    }
    const allowance =
      after === null ? '' : after === 0 ? ' You’re out of free scans this month.' : ` ${after} free ${after === 1 ? 'scan' : 'scans'} left this month.`;
    return json(422, {
      error: `That doesn’t look like a receipt. Try a clearer photo, flat and in good light.${allowance}`,
      scansLeft: after,
    });
  }
  await markSucceeded();
  return json(200, { draft, scansLeft: left });
});
