// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { anniversaryLabel, arrangeMemories } from './memoriesArrange.ts';

const now = new Date('2026-10-30T12:00:00Z');
const ev = (id: string, starts: string, ends: string, cover: string | null = null) => ({
  id,
  title: id,
  starts_at: starts,
  ends_at: ends,
  cover_photo_id: cover,
});
const ph = (id: string, event: string, kind: 'photo' | 'video' = 'photo', uploader = 'u1') => ({
  id,
  event_id: event,
  uploader_id: uploader,
  storage_path: `${event}/${id}.jpg`,
  kind,
});

describe('arrangeMemories', () => {
  test('only past events with photos, newest first', () => {
    const out = arrangeMemories(
      [
        ev('old', '2026-10-01T18:00:00Z', '2026-10-01T22:00:00Z'),
        ev('recent', '2026-10-20T18:00:00Z', '2026-10-20T22:00:00Z'),
        ev('empty', '2026-10-25T18:00:00Z', '2026-10-25T22:00:00Z'),
        ev('upcoming', '2026-11-05T18:00:00Z', '2026-11-05T22:00:00Z'),
      ],
      [ph('a', 'old'), ph('b', 'recent'), ph('c', 'recent'), ph('d', 'upcoming')],
      new Set(),
      now
    );
    assert.deepEqual(
      out.map((m) => [m.eventId, m.photoCount]),
      [
        ['recent', 2],
        ['old', 1],
      ]
    );
  });

  test('the event photo wins, then the first photo over a video', () => {
    const past = ['2026-10-01T18:00:00Z', '2026-10-01T22:00:00Z'] as const;
    const [withCover] = arrangeMemories([ev('e', ...past, 'z')], [ph('v', 'e', 'video'), ph('p', 'e'), ph('z', 'e')], new Set(), now);
    assert.equal(withCover.coverPath, 'e/z.jpg');
    const [noCover] = arrangeMemories([ev('e', ...past)], [ph('v', 'e', 'video'), ph('p', 'e')], new Set(), now);
    assert.equal(noCover.coverPath, 'e/p.jpg');
    const [videosOnly] = arrangeMemories([ev('e', ...past)], [ph('v', 'e', 'video')], new Set(), now);
    assert.equal(videosOnly.coverPath, 'e/v.jpg');
  });

  test('photos from blocked people don’t count or show', () => {
    const out = arrangeMemories(
      [ev('e', '2026-10-01T18:00:00Z', '2026-10-01T22:00:00Z')],
      [ph('a', 'e', 'photo', 'blocked')],
      new Set(['blocked']),
      now
    );
    assert.equal(out.length, 0);
  });
});

describe('anniversaryLabel', () => {
  // Local dates, as the phone sees them.
  const at = (y: number, m: number, d: number, h = 19) => new Date(y, m - 1, d, h).toISOString();
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

  test('1, 3 and 6 months, then whole years', () => {
    const event = at(2025, 4, 15);
    assert.equal(anniversaryLabel(event, day(2025, 5, 15)), 'From 1 month ago');
    assert.equal(anniversaryLabel(event, day(2025, 7, 15)), 'From 3 months ago');
    assert.equal(anniversaryLabel(event, day(2025, 10, 15)), 'From 6 months ago');
    assert.equal(anniversaryLabel(event, day(2026, 4, 15)), 'From 1 year ago');
    assert.equal(anniversaryLabel(event, day(2027, 4, 15)), 'From 2 years ago');
    assert.equal(anniversaryLabel(event, day(2125, 4, 15)), 'From 100 years ago');
  });

  test('other months and other days don’t count', () => {
    const event = at(2025, 4, 15);
    assert.equal(anniversaryLabel(event, day(2025, 6, 15)), null);
    assert.equal(anniversaryLabel(event, day(2025, 9, 15)), null);
    assert.equal(anniversaryLabel(event, day(2026, 10, 15)), null);
    assert.equal(anniversaryLabel(event, day(2026, 4, 16)), null);
    assert.equal(anniversaryLabel(event, day(2025, 4, 15)), null);
    assert.equal(anniversaryLabel(event, day(2126, 4, 15)), null);
  });

  test('the 31st comes back on the last day of a shorter month', () => {
    assert.equal(anniversaryLabel(at(2025, 1, 31), day(2025, 2, 28)), 'From 1 month ago');
    assert.equal(anniversaryLabel(at(2025, 3, 31), day(2025, 6, 30)), 'From 3 months ago');
    assert.equal(anniversaryLabel(at(2024, 2, 29), day(2025, 2, 28)), 'From 1 year ago');
    assert.equal(anniversaryLabel(at(2024, 2, 29), day(2028, 2, 29)), 'From 4 years ago');
  });
});
