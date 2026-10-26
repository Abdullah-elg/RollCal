// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildMessages, chunk, deadTokens, type OutboxRow, type TokenRow } from './messages.ts';

const row = (extra: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1,
  user_id: 'u1',
  kind: 'chatMessage',
  event_id: 'e1',
  title: 'Dinner',
  body: 'Sam: hi',
  data: { type: 'chat', eventId: 'e1' },
  ...extra,
});
const phone = (token: string, extra: Partial<TokenRow> = {}): TokenRow => ({
  token,
  user_id: 'u1',
  platform: 'ios',
  prefs: {},
  muted_events: [],
  ...extra,
});

describe('buildMessages', () => {
  test('sends to every phone of the person', () => {
    const out = buildMessages([row()], [phone('a'), phone('b'), phone('c', { user_id: 'u2' })]);
    assert.deepEqual(
      out.map((m) => m.to),
      ['a', 'b']
    );
    assert.equal(out[0].threadId, 'e1');
    assert.equal(out[0].priority, 'high');
  });

  test('skips phones that turned the kind off, and keeps missing kinds on', () => {
    const out = buildMessages(
      [row(), row({ id: 2, kind: 'friendRequest', event_id: null, data: {} })],
      [phone('a', { prefs: { chatMessage: false } })]
    );
    assert.deepEqual(
      out.map((m) => m.title),
      ['Dinner']
    );
    assert.equal(out[0].body, 'Sam: hi');
    assert.equal(out[0].threadId, undefined);
  });

  test('skips chats muted on that phone only', () => {
    const out = buildMessages([row()], [phone('a', { muted_events: ['e1'] }), phone('b')]);
    assert.deepEqual(
      out.map((m) => m.to),
      ['b']
    );
  });

  test('muting a chat does not mute the roll opening for that event', () => {
    const out = buildMessages(
      [row({ kind: 'albumOpen' })],
      [phone('a', { muted_events: ['e1'] })]
    );
    assert.equal(out.length, 1);
  });

  test('nobody to send to', () => {
    assert.deepEqual(buildMessages([row()], []), []);
  });
});

describe('chunk', () => {
  test('splits into groups', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 100), []);
  });
});

describe('deadTokens', () => {
  test('only DeviceNotRegistered, matched by position', () => {
    const sent = buildMessages([row()], [phone('a'), phone('b'), phone('c')]);
    const dead = deadTokens(sent, [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]);
    assert.deepEqual(dead, ['b']);
  });
});

describe('badge', () => {
  test('carries the person’s count, and leaves it off when unknown', () => {
    const rows = [
      { id: 1, user_id: 'a', kind: 'chatMessage', event_id: 'e', title: 't', body: 'b', data: {} },
      { id: 2, user_id: 'b', kind: 'chatMessage', event_id: 'e', title: 't', body: 'b', data: {} },
    ];
    const tokens = [
      { token: 'ta', user_id: 'a', platform: 'ios', prefs: {}, muted_events: [] },
      { token: 'tb', user_id: 'b', platform: 'ios', prefs: {}, muted_events: [] },
    ];
    const sent = buildMessages(rows, tokens, { a: 3 });
    assert.equal(sent.find((m) => m.to === 'ta')?.badge, 3);
    assert.equal(sent.find((m) => m.to === 'tb')?.badge, undefined);
  });
});
