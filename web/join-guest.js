// Joining an event in the browser, without the app (feature D). Loaded by
// web/join/index.html; it lives at the site root because every /join/...
// address is rewritten to that page.
//
// A guest is a Supabase anonymous user. They pass Cloudflare Turnstile (the
// bot check), give a name, and join with the invite code. After that they can
// see the event and its photos and add their own while the roll is open;
// the database allows guests nothing else (supabase/guest-web.sql).
// Photos are re-saved through a canvas before they upload, which leaves the
// location and other hidden details behind, as the app does.
//
// The Supabase address and publishable key are public by design (they're in
// the app too); what a guest may do is decided by the database.

// supabase-js is loaded by the page from /vendor (a global, not an import).
const { createClient } = window.supabase;

// RollCal's own address for the database (a Supabase custom domain), so
// the backend can move without this page changing.
const SUPABASE_URL = 'https://api.rollcal.app';
const SUPABASE_KEY = document.querySelector('meta[name="supabase-key"]').content;
const TURNSTILE_KEY = document.querySelector('meta[name="turnstile-key"]').content;
const MEDIA_URL = 'https://media.rollcal.app';

const MAX_SIDE = 2560;
const PHOTO_QUALITY = 0.8;
const THUMB_SIDE = 480;
const THUMB_QUALITY = 0.7;
const HOUR = 60 * 60 * 1000;

const REASONS = [
  ['harassment', 'Bullying or harassment'],
  ['hate', 'Hate speech or symbols'],
  ['nudity', 'Nudity or sexual content'],
  ['violence', 'Violence or threats'],
  ['child_safety', 'Involves a child'],
  ['spam', 'Spam or scams'],
  ['other', 'Something else'],
];

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, storageKey: 'rollcal-guest', detectSessionInUrl: false },
});

const $ = (id) => document.getElementById(id);
const code = (window.ROLLCAL_INVITE_CODE || '').trim();
let captchaToken = null;
let event = null;
let me = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function show(id) {
  for (const s of ['guest-form', 'guest-event', 'guest-waiting']) $(s).hidden = s !== id;
  $('web-join').hidden = false;
  $('landing').hidden = true;
}

function say(id, text) {
  const el = $(id);
  el.textContent = text || '';
  el.hidden = !text;
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Same rule as the app (src/lib/roll.ts): open from the start until 48 hours
// after the end, or a host's reopening, unless the host closed it.
function rollOpen(ev, now = Date.now()) {
  const opens = new Date(ev.starts_at).getTime();
  const closes = Math.max(
    new Date(ev.ends_at).getTime() + 48 * HOUR,
    ev.uploads_reopened_until ? new Date(ev.uploads_reopened_until).getTime() : 0
  );
  return { beforeOpen: now < opens, open: now >= opens && now <= closes && !ev.uploads_closed };
}

async function mediaHeaders() {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } : null;
}

function friendly(error, fallback) {
  const hint = error?.hint;
  if (hint === 'limit') return error.message || 'There’s no more room for photos here.';
  if (hint === 'guest') return 'Guests can only see and add photos. Get the app to do more.';
  if (error?.code === '42501') return error.message || fallback;
  return fallback;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------
function renderTurnstile() {
  if (!TURNSTILE_KEY) return;
  const draw = () =>
    window.turnstile.render('#turnstile', {
      sitekey: TURNSTILE_KEY,
      callback: (t) => { captchaToken = t; },
      'expired-callback': () => { captchaToken = null; },
      'error-callback': () => { captchaToken = null; },
    });
  if (window.turnstile) draw();
  else window.addEventListener('turnstile-ready', draw, { once: true });
}

async function join(e) {
  e.preventDefault();
  say('form-error', '');
  const name = $('guest-name').value.trim();
  if (!name || name.length > 40) return say('form-error', 'Add your name (up to 40 letters).');
  if (!$('guest-age').checked) return say('form-error', 'You need to be 13 or older to join.');

  const button = $('join-submit');
  button.disabled = true;
  button.textContent = 'Joining…';
  try {
    let { data } = await sb.auth.getSession();
    if (!data.session) {
      if (TURNSTILE_KEY && !captchaToken) throw new Error('Please finish the check above first.');
      const res = await sb.auth.signInAnonymously({ options: { captchaToken: captchaToken || undefined } });
      if (res.error) throw new Error('Couldn’t start. Please try the check again.');
      data = res.data;
    }
    me = data.session.user;

    const { error: nameError } = await sb.from('profiles').upsert({ id: me.id, display_name: name });
    if (nameError) throw new Error(nameError.message || 'Couldn’t save your name.');

    const { data: found } = await sb.rpc('get_event_by_code', { code });
    const ev = Array.isArray(found) ? found[0] : found;
    if (!ev) throw new Error('This invite isn’t active any more. Ask the host for a new link.');

    const { data: joined, error: joinError } = await sb.rpc('join_event', { p_event: ev.id });
    if (joinError) throw new Error(friendly(joinError, 'Couldn’t join this event.'));
    if (joined === 'requested') {
      $('waiting-title').textContent = ev.title;
      show('guest-waiting');
      return;
    }
    await openEvent(ev.id);
  } catch (err) {
    say('form-error', err.message);
    if (window.turnstile) window.turnstile.reset('#turnstile');
    captchaToken = null;
  } finally {
    button.disabled = false;
    button.textContent = 'Join';
  }
}

// ---------------------------------------------------------------------------
// The event and its photos
// ---------------------------------------------------------------------------
async function openEvent(eventId) {
  const { data: ev, error } = await sb.from('events').select('*').eq('id', eventId).maybeSingle();
  if (error || !ev) throw new Error('Couldn’t open this event.');
  event = ev;
  $('ev-title').textContent = ev.title;
  $('ev-when').textContent = formatWhen(ev.starts_at) + (ev.location ? ` · ${ev.location}` : '');
  const roll = rollOpen(ev);
  $('add-photos').hidden = !roll.open;
  say(
    'roll-note',
    roll.beforeOpen
      ? 'The roll opens when the event starts. Come back then to add photos.'
      : roll.open
        ? ''
        : 'The roll is closed, so no more photos can be added.'
  );
  show('guest-event');
  await loadPhotos();
}

async function loadPhotos() {
  const { data: rows } = await sb
    .from('photos')
    .select('id, storage_path, kind, uploader_id')
    .eq('event_id', event.id)
    .order('created_at', { ascending: true });
  const photos = (rows || []).filter((p) => p.kind === 'photo');
  $('exp').textContent = String(photos.length).padStart(2, '0');
  const grid = $('grid');
  grid.replaceChildren();
  if (photos.length === 0) {
    say('grid-empty', 'No photos yet.');
    return;
  }
  say('grid-empty', '');
  const headers = await mediaHeaders();
  const links = {};
  for (let i = 0; i < photos.length; i += 200) {
    const res = await fetch(`${MEDIA_URL}/v1/links`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: 'event-photos', names: photos.slice(i, i + 200).map((p) => p.storage_path) }),
    });
    if (res.ok) Object.assign(links, (await res.json()).links || {});
  }
  for (const p of photos) {
    const link = links[p.storage_path];
    if (!link) continue;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.setAttribute('aria-label', 'Open photo');
    const img = document.createElement('img');
    img.src = link.thumb || link.url;
    img.alt = '';
    img.loading = 'lazy';
    tile.append(img);
    tile.addEventListener('click', () => openViewer(p, link.url));
    grid.append(tile);
  }
}

// Re-saves a picked photo as a JPEG (at most MAX_SIDE across) and makes the
// small preview. Drawing it on a canvas keeps only the pixels.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file can’t be added here. Try a JPEG or PNG photo.'));
    };
    img.src = url;
  });
}

function draw(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function uploadOne(file) {
  const { img, url } = await loadImage(file);
  let body;
  let thumb;
  try {
    body = await draw(img, MAX_SIDE, PHOTO_QUALITY);
    thumb = await draw(img, THUMB_SIDE, THUMB_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!body) throw new Error('Couldn’t read that photo.');

  const headers = await mediaHeaders();
  const reserve = await fetch(`${MEDIA_URL}/v1/uploads`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      bucket: 'event-photos',
      eventId: event.id,
      contentType: 'image/jpeg',
      size: body.size,
      thumbSize: thumb ? thumb.size : 0,
    }),
  });
  const reserved = await reserve.json().catch(() => ({}));
  if (!reserve.ok || !reserved.name) throw new Error(friendly(reserved, 'Couldn’t add that photo.'));

  const target = `${MEDIA_URL}/v1/uploads/event-photos/${reserved.name}`;
  const put = await fetch(target, { method: 'PUT', headers: { ...headers, 'content-type': 'image/jpeg' }, body });
  if (!put.ok && put.status !== 409) throw new Error('The photo didn’t finish uploading.');
  if (thumb) {
    await fetch(`${target}?part=thumb`, { method: 'PUT', headers: { ...headers, 'content-type': 'image/jpeg' }, body: thumb }).catch(() => {});
  }
  const done = await fetch(`${target}/done`, { method: 'POST', headers });
  if (!done.ok) throw new Error('The photo didn’t finish uploading.');

  const { error } = await sb.from('photos').insert({ event_id: event.id, uploader_id: me.id, storage_path: reserved.name });
  if (error) {
    await sb.rpc('discard_media', { p_bucket: 'event-photos', p_name: reserved.name });
    throw new Error(friendly(error, 'Couldn’t add that photo.'));
  }
}

async function addPhotos(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (list.length === 0) return;
  say('upload-error', '');
  const button = $('add-photos');
  button.disabled = true;
  let added = 0;
  try {
    for (const file of list) {
      button.textContent = `Adding ${added + 1} of ${list.length}…`;
      await uploadOne(file);
      added += 1;
    }
  } catch (err) {
    say('upload-error', err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Add photos';
    $('file').value = '';
    if (added > 0) await loadPhotos();
  }
}

// ---------------------------------------------------------------------------
// Viewing and reporting one photo
// ---------------------------------------------------------------------------
let viewing = null;

function openViewer(photo, url) {
  viewing = photo;
  $('viewer-img').src = url;
  $('report-box').hidden = true;
  say('report-note', '');
  $('report-open').hidden = photo.uploader_id === me?.id;
  $('viewer').showModal();
}

async function sendReport(e) {
  e.preventDefault();
  if (!viewing || !me) return;
  const reason = $('report-reason').value;
  const { error } = await sb.from('reports').insert({
    reporter_id: me.id,
    target_type: 'photo',
    target_id: viewing.id,
    target_user_id: viewing.uploader_id,
    reason,
    details: null,
  });
  $('report-box').hidden = true;
  say('report-note', error ? 'Couldn’t send that. Please try again.' : 'Thanks. RollCal support will look at it.');
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  for (const [value, label] of REASONS) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    $('report-reason').append(o);
  }
  $('join-web').addEventListener('click', () => {
    show('guest-form');
    renderTurnstile();
  });
  $('guest-form').addEventListener('submit', join);
  $('add-photos').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => addPhotos(e.target.files));
  $('viewer-close').addEventListener('click', () => $('viewer').close());
  $('report-open').addEventListener('click', () => { $('report-box').hidden = false; });
  $('report-box').addEventListener('submit', sendReport);

  if (!code) {
    $('join-web').hidden = true;
    return;
  }
  // Back again on the same browser: go straight to the event if they're in it.
  const { data } = await sb.auth.getSession();
  if (data.session?.user?.is_anonymous) {
    me = data.session.user;
    const { data: found } = await sb.rpc('get_event_by_code', { code });
    const ev = Array.isArray(found) ? found[0] : found;
    if (ev) {
      const { data: mine } = await sb.from('rsvps').select('event_id').eq('event_id', ev.id).eq('user_id', me.id).maybeSingle();
      if (mine) await openEvent(ev.id).catch(() => {});
    }
  }
}

start();
