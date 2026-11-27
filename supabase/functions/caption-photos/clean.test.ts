// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { allowedImageUrl, cleanCaption, cleanScore } from './clean.ts';

describe('cleanCaption', () => {
  test('tidies quotes, emoji, hashtags and the full stop', () => {
    assert.equal(cleanCaption('"golden hour by the cars 🔥 #vibes."'), 'Golden hour by the cars');
  });
  test('one line', () => {
    assert.equal(cleanCaption('Ping pong\nshowdown'), 'Ping pong showdown');
  });
  test('cuts long ones at a word', () => {
    const long = 'A very long caption that goes on and on about the table and the chairs and the lights and more';
    const out = cleanCaption(long)!;
    assert.ok(out.length <= 80);
    assert.ok(!out.endsWith(' '));
    assert.ok(long.startsWith(out));
  });
  test('rejects nothing useful', () => {
    assert.equal(cleanCaption(''), null);
    assert.equal(cleanCaption('🔥'), null);
    assert.equal(cleanCaption(42), null);
  });
});

describe('allowedImageUrl', () => {
  const hosts = ['media.rollcal.app'];
  test('our host over https only', () => {
    assert.ok(allowedImageUrl('https://media.rollcal.app/x.jpg?sig=1', hosts));
    assert.ok(!allowedImageUrl('http://media.rollcal.app/x.jpg', hosts));
    assert.ok(!allowedImageUrl('https://evil.example/x.jpg', hosts));
    assert.ok(!allowedImageUrl('https://media.rollcal.app.evil.example/x.jpg', hosts));
    assert.ok(!allowedImageUrl('not a url', hosts));
  });
});

describe('cleanScore', () => {
  test('whole numbers 1 to 10', () => {
    assert.equal(cleanScore(7), 7);
    assert.equal(cleanScore('8'), 8);
    assert.equal(cleanScore(7.6), 8);
    assert.equal(cleanScore(0), 1);
    assert.equal(cleanScore(42), 10);
    assert.equal(cleanScore('great'), null);
    assert.equal(cleanScore(undefined), null);
  });
});
