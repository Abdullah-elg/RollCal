// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { eventInitial, isLiveNow, pickMemoryStrip } from './homeEvents.ts';

describe('isLiveNow', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  test('inside, before and after', () => {
    assert.equal(isLiveNow('2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z', now), true);
    assert.equal(isLiveNow('2026-01-01T13:00:00Z', '2026-01-01T14:00:00Z', now), false);
    assert.equal(isLiveNow('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z', now), false);
  });
});

describe('eventInitial', () => {
  test('first letter, uppercased', () => {
    assert.equal(eventInitial('  beach day'), 'B');
    assert.equal(eventInitial(''), '•');
  });
});

describe('pickMemoryStrip', () => {
  test('drops pictureless, newest first, capped', () => {
    const m = (d: number, p: string | null) => ({
      startsAt: `2026-01-0${d}T00:00:00Z`,
      coverPath: p,
    });
    const out = pickMemoryStrip([m(1, 'a'), m(3, null), m(2, 'b'), m(4, 'c')], 2);
    assert.deepEqual(out.map((x) => x.coverPath), ['c', 'b']);
  });
});
