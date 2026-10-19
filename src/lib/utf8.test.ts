// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './utf8.ts';

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

describe('base64', () => {
  test('matches the platform encoder at every padding length', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'héllo 🎉', '{"access_token":"x.y.z"}']) {
      const bytes = utf8Encode(text);
      const b64 = Buffer.from(bytes).toString('base64');
      assert.equal(bytesToBase64(bytes), b64, text);
      assert.deepEqual(base64ToBytes(b64), bytes, text);
    }
  });

  test('random bytes round trip', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 97 + 13) % 256);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });

  test('rejects junk', () => {
    assert.throws(() => base64ToBytes('not*base64'));
  });
});
