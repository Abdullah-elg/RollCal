// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PHOTO_AREA, pickRecapPhotos, recapLayout } from './recap.ts';

describe('recapLayout', () => {
  test('every count fills the photo area exactly, without overlaps', () => {
    for (let n = 1; n <= 6; n++) {
      const rects = recapLayout(n);
      assert.equal(rects.length, n);
      for (const r of rects) {
        assert.ok(r.x >= PHOTO_AREA.x && r.y >= PHOTO_AREA.y);
        assert.ok(r.x + r.width <= PHOTO_AREA.x + PHOTO_AREA.width);
        assert.ok(r.y + r.height <= PHOTO_AREA.y + PHOTO_AREA.height + 1);
      }
      // Rows end flush with the right edge.
      const right = Math.max(...rects.map((r) => r.x + r.width));
      assert.equal(right, PHOTO_AREA.x + PHOTO_AREA.width);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const apart =
            a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          assert.ok(apart, `tiles ${i} and ${j} overlap for ${n}`);
        }
      }
    }
  });

  test('more than six still lays out six', () => {
    assert.equal(recapLayout(40).length, 6);
  });
});

describe('pickRecapPhotos', () => {
  const roll = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'photo' as const, hasPicture: true }));

  test('cover first, then spread across the roll', () => {
    const photos = roll(20);
    const picked = pickRecapPhotos(photos, 'p7');
    assert.equal(picked.length, 6);
    assert.equal(picked[0].id, 'p7');
    assert.ok(!picked.slice(1).some((p) => p.id === 'p7'));
    assert.equal(picked[1].id, 'p0');
    assert.equal(picked[picked.length - 1].id, 'p19');
  });

  test('without a cover, six spread out; a short roll uses them all', () => {
    assert.deepEqual(
      pickRecapPhotos(roll(11), null).map((p) => p.id),
      ['p0', 'p2', 'p4', 'p6', 'p8', 'p10']
    );
    assert.equal(pickRecapPhotos(roll(3), null).length, 3);
  });

  test('videos without a still are left out', () => {
    const photos = [
      { id: 'v', kind: 'video' as const, hasPicture: false },
      { id: 'p', kind: 'photo' as const, hasPicture: true },
    ];
    assert.deepEqual(pickRecapPhotos(photos, 'v').map((p) => p.id), ['p']);
  });

  test('shuffle picks a different set, still in roll order', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const picked = pickRecapPhotos(roll(30), null, random);
    assert.equal(picked.length, 6);
    const order = picked.map((p) => Number(p.id.slice(1)));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
});
