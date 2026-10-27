// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { seenBy, seenPositions } from './seenBy.ts';

const msg = { sender_id: 'amr', created_at: '2026-10-24T18:00:00Z' };

describe('seenBy', () => {
  test('people who read at or after the message, earliest first', () => {
    const reads = {
      haadi: '2026-10-24T18:05:00Z',
      sara: '2026-10-24T18:00:00Z',
      old: '2026-10-24T17:59:59Z',
    };
    assert.deepEqual(seenBy(reads, msg, 'me'), ['sara', 'haadi']);
  });

  test('never the sender or the person looking', () => {
    const reads = { amr: '2026-10-24T19:00:00Z', me: '2026-10-24T19:00:00Z' };
    assert.deepEqual(seenBy(reads, msg, 'me'), []);
  });
});

describe('seenPositions', () => {
  const messages = [
    { id: 'm1', sender_id: 'me', created_at: '2026-10-24T18:00:00Z' },
    { id: 'm2', sender_id: 'amr', created_at: '2026-10-24T18:10:00Z' },
    { id: 'm3', sender_id: 'me', created_at: '2026-10-24T18:20:00Z' },
  ];

  test('each reader sits under the newest message they have seen', () => {
    const reads = {
      sara: '2026-10-24T18:05:00Z', // saw m1 only
      haadi: '2026-10-24T18:30:00Z', // saw everything
    };
    const placed = seenPositions(reads, messages, 'me');
    assert.deepEqual(placed.get('m1'), ['sara']);
    assert.deepEqual(placed.get('m3'), ['haadi']);
    assert.equal(placed.get('m2'), undefined);
  });

  test('no mark when the newest message they have seen is their own', () => {
    // amr read right after sending m2, before m3 arrived.
    const placed = seenPositions({ amr: '2026-10-24T18:11:00Z' }, messages, 'me');
    assert.equal(placed.size, 0);
  });

  test('no mark when they wrote after their saved read time', () => {
    // amr opened the chat at 18:05, then sent m2 at 18:10.
    const placed = seenPositions({ amr: '2026-10-24T18:05:00Z' }, messages, 'me');
    assert.equal(placed.size, 0);
  });

  test('a mark again once someone else writes after them', () => {
    const placed = seenPositions({ amr: '2026-10-24T18:25:00Z' }, messages, 'me');
    assert.deepEqual(placed.get('m3'), ['amr']);
  });

  test('never the person looking, and nobody who read before any message', () => {
    const placed = seenPositions(
      { me: '2026-10-24T19:00:00Z', early: '2026-10-24T17:00:00Z' },
      messages,
      'me'
    );
    assert.equal(placed.size, 0);
  });
});
