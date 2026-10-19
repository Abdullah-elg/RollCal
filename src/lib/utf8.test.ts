// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { utf8Decode, utf8Encode } from './utf8.ts';

describe('utf8', () => {
  test('matches the platform encoder', () => {
    for (const text of ['', 'hello', 'café', '€12,50', '日本語', 'emoji 🎉📸', '{"access_token":"a.b.c"}']) {
      assert.deepEqual(utf8Encode(text), new TextEncoder().encode(text), text);
    }
  });

  test('round trips', () => {
    const text = 'José paid 💸 ¥1200 — "ok"\n';
    assert.equal(utf8Decode(utf8Encode(text)), text);
  });
});
