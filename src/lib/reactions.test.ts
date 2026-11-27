// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { badgeFor, summarize } from './reactionsSummary.ts';

describe('summarize', () => {
  const rows = [
    { photo_id: 'a', user_id: 'me', emoji: '❤️' },
    { photo_id: 'a', user_id: 'u2', emoji: '❤️' },
    { photo_id: 'a', user_id: 'u2', emoji: '🔥' },
    { photo_id: 'b', user_id: 'u3', emoji: '😂' },
    { photo_id: 'b', user_id: 'u3', emoji: '👎' },
  ];
  const m = summarize(rows, 'me');
  test('counts per emoji and mine', () => {
    assert.equal(m.get('a')?.counts['❤️'], 2);
    assert.equal(m.get('a')?.counts['🔥'], 1);
    assert.deepEqual([...(m.get('a')?.mine ?? [])], ['❤️']);
    assert.equal(m.get('b')?.mine.size, 0);
  });
  test('ignores unknown emoji and photos with none', () => {
    assert.equal(m.get('b')?.counts['😂'], 1);
    assert.equal(m.has('c'), false);
  });
  test('badge shows top emoji and total', () => {
    assert.deepEqual(badgeFor(m.get('a')), { emoji: '❤️', total: 3 });
    assert.equal(badgeFor(undefined), null);
  });
});
