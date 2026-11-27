// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildRecapScenes,
  highlightCount,
  MAX_ALL_PHOTOS,
  MAX_TOTAL_MS,
  MIN_TOTAL_MS,
  motionFor,
  photoMs,
  recapCaption,
  totalMs,
} from './videoRecap.ts';
import { pickHighlights, pickPicturePhotos } from './recap.ts';

const pic = (id: string, hasPicture = true, reactions = 0, score: number | null = null) => ({
  id,
  kind: 'photo' as const,
  hasPicture,
  reactions,
  score,
});
const roll = (n: number) => Array.from({ length: n }, (_, i) => pic(String(i)));
const played = (scenes: ReturnType<typeof buildRecapScenes>) =>
  scenes.flatMap((s) => (s.kind === 'photo' ? [s.photo.id] : []));

describe('buildRecapScenes', () => {
  test('is empty with no usable photos', () => {
    assert.deepEqual(buildRecapScenes([], null), []);
    assert.deepEqual(buildRecapScenes([pic('a', false)], null), []);
  });

  test('title over the cover, which does not play again', () => {
    const scenes = buildRecapScenes([pic('a'), pic('b'), pic('c')], 'b');
    assert.equal(scenes[0].kind === 'title' && scenes[0].photo?.id, 'b');
    assert.equal(scenes[scenes.length - 1].kind, 'end');
    assert.deepEqual(played(scenes), ['a', 'c']);
  });

  test('a single photo still plays', () => {
    assert.deepEqual(buildRecapScenes([pic('a')], null).map((s) => s.kind), ['title', 'photo', 'end']);
  });

  test('no photo appears twice', () => {
    for (const mode of ['all', 'highlights'] as const) {
      const scenes = buildRecapScenes(roll(30), '7', { mode });
      const ids = scenes.flatMap((s) => (s.kind === 'title' && s.photo ? [s.photo.id] : s.kind === 'photo' ? [s.photo.id] : []));
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  test('every video is 15 s to 1 min when there are a few photos or many', () => {
    for (const n of [3, 5, 9, 20, 39, 80, 300]) {
      for (const mode of ['all', 'highlights'] as const) {
        const t = totalMs(buildRecapScenes(roll(n), null, { mode }));
        assert.ok(t >= MIN_TOTAL_MS && t <= MAX_TOTAL_MS, `${mode} ${n}: ${t}`);
      }
    }
  });

  test('all photos: every one plays, up to what fits in a minute', () => {
    assert.equal(played(buildRecapScenes(roll(12), null)).length, 11);
    const many = played(buildRecapScenes(roll(200), null));
    assert.equal(many.length, MAX_ALL_PHOTOS);
    assert.equal(many[many.length - 1], '199'); // spread to the end of the night
  });

  test('highlights: the most-reacted and best-looking, in roll order', () => {
    const photos = roll(20);
    photos[15].reactions = 4;
    photos[3].score = 10;
    photos[9].reactions = 2;
    const ids = played(buildRecapScenes(photos, '0', { mode: 'highlights' }));
    assert.equal(ids.length, highlightCount(20));
    for (const id of ['3', '9', '15']) assert.ok(ids.includes(id), id);
    assert.deepEqual([...ids].sort((a, b) => +a - +b), ids);
  });
});

describe('photoMs and highlightCount', () => {
  test('stretches few photos, squeezes many', () => {
    assert.ok(photoMs(3) > photoMs(9));
    assert.ok(photoMs(39) >= 1400);
    assert.ok(photoMs(1) <= 5000);
  });
  test('highlights are 4 to 8 photos (or all when fewer)', () => {
    assert.equal(highlightCount(3), 3);
    assert.equal(highlightCount(10), 4);
    assert.equal(highlightCount(15), 6);
    assert.equal(highlightCount(100), 8);
  });
});

describe('pickHighlights / pickPicturePhotos', () => {
  test('a few reactions beat a great look; ties go to the earlier photo', () => {
    const photos = [pic('a', true, 0, 9), pic('b', true, 3, 1), pic('c', true, 0, 9)];
    assert.deepEqual(pickHighlights(photos, 1).map((p) => p.id), ['b']);
    assert.deepEqual(pickHighlights(photos, 2).map((p) => p.id), ['a', 'b']);
  });
  test('the picture uses the cover and the best of the rest', () => {
    const photos = roll(12);
    photos[11].reactions = 5;
    const ids = pickPicturePhotos(photos, '4').map((p) => p.id);
    assert.equal(ids[0], '4');
    assert.ok(ids.includes('11'));
    assert.equal(ids.length, 6);
  });
});

describe('motionFor', () => {
  test('every move starts centred and pushes in (no zoom out)', () => {
    for (let i = 0; i < 4; i++) {
      const m = motionFor(i);
      assert.equal(m.fromX, 0);
      assert.equal(m.fromY, 0);
      assert.ok(m.toScale > m.fromScale);
    }
  });
  test('alternates and never drifts past the zoom (no edges show)', () => {
    assert.notDeepEqual(motionFor(0), motionFor(1));
    for (let i = 0; i < 8; i++) {
      const m = motionFor(i);
      for (const [s, x, y] of [
        [m.fromScale, m.fromX, m.fromY],
        [m.toScale, m.toX, m.toY],
      ]) {
        assert.ok(Math.abs(x) <= (s - 1) / 2 + 1e-9);
        assert.ok(Math.abs(y) <= (s - 1) / 2 + 1e-9);
      }
    }
  });
});

describe('recapCaption', () => {
  test('first name and time', () => {
    assert.equal(recapCaption('Sara Malik', '8:14 PM'), 'Sara · 8:14 PM');
  });
  test('leaves out what is missing', () => {
    assert.equal(recapCaption('  ', '8:14 PM'), '8:14 PM');
    assert.equal(recapCaption('Sara', null), 'Sara');
    assert.equal(recapCaption(null, undefined), '');
  });
});

import { recapSignature } from './videoRecap.ts';

describe('recapSignature', () => {
  test('same photos same signature; any change makes a new one', () => {
    const a = buildRecapScenes(roll(10), '0');
    const same = buildRecapScenes(roll(10), '0');
    assert.equal(recapSignature('all', a), recapSignature('all', same));
    assert.notEqual(recapSignature('all', a), recapSignature('highlights', a));
    assert.notEqual(recapSignature('all', a), recapSignature('all', buildRecapScenes(roll(11), '0')));
    assert.match(recapSignature('all', a), /^all:10:[0-9a-f]{8}$/);
  });
});
