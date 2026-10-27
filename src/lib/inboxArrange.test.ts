import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { arrangeInbox, markSeen } from './inboxArrange.ts';

const now = new Date('2026-10-27T12:00:00Z').getTime();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

describe('arrangeInbox', () => {
  const items = [
    { key: 'a', at: hoursAgo(1) },
    { key: 'b', at: hoursAgo(5) },
    { key: 'c', at: hoursAgo(80) },
    { key: 'd', at: hoursAgo(90), pending: true },
  ];

  test('unseen items are new, newest first, however old', () => {
    const { fresh, earlier } = arrangeInbox(items, {}, now);
    assert.deepEqual(fresh.map((i) => i.key), ['a', 'b', 'c', 'd']);
    assert.equal(earlier.length, 0);
  });

  test('seen items stay for 2 days after being seen', () => {
    const seen = { a: hoursAgo(1), b: hoursAgo(47), c: hoursAgo(49) };
    const { fresh, earlier } = arrangeInbox(items, seen, now);
    assert.deepEqual(fresh.map((i) => i.key), ['d']);
    assert.deepEqual(earlier.map((i) => i.key), ['a', 'b']);
  });

  test('a request waiting on you stays until answered', () => {
    const { earlier } = arrangeInbox(items, { d: hoursAgo(100) }, now);
    assert.deepEqual(earlier.map((i) => i.key), ['d']);
  });
});

describe('markSeen', () => {
  test('keeps the first time something was seen', () => {
    const next = markSeen({ a: hoursAgo(10) }, ['a', 'b'], now);
    assert.equal(next.a, hoursAgo(10));
    assert.equal(next.b, new Date(now).toISOString());
  });

  test('forgets marks older than 30 days', () => {
    const next = markSeen({ old: hoursAgo(24 * 31) }, [], now);
    assert.deepEqual(next, {});
  });
});
