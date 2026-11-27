import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize } from './fitSize.ts';

test('resize keeps the shape with whole, even sides', () => {
  const s = fitSize(4032, 3024, 2048);
  assert.deepEqual(s, { width: 2048, height: 1536 });
  const t = fitSize(1000, 1333, 640); // would be 480.1... wide
  assert.equal(t.height, 640);
  assert.equal(t.width % 2, 0);
  assert.ok(Number.isInteger(t.width));
});
