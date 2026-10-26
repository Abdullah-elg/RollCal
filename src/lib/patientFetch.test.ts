// Run with: npm test
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { patientFetch, setTimeScaleForTests } from './patientFetch.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
setTimeScaleForTests(0.001); // 12 s becomes 12 ms

// A fake network: the first `stalls` requests never answer (like a dead
// connection) until they're cancelled; later ones answer at once.
function fakeNetwork(stalls: number) {
  let calls = 0;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    calls += 1;
    if (calls <= stalls) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(new Response('ok'));
  }) as typeof fetch;
  return () => calls;
}

describe('patientFetch', () => {
  test('a stalled read gives up and the retry gets through', async () => {
    const calls = fakeNetwork(1);
    const res = await patientFetch('https://x.supabase.co/rest/v1/events');
    assert.equal(await res.text(), 'ok');
    assert.equal(calls(), 2);
  });

  test('a read that stalls twice fails instead of hanging', async () => {
    fakeNetwork(5);
    await assert.rejects(patientFetch('https://x.supabase.co/rest/v1/events'), /too long/);
  });

  test('writes are never sent twice', async () => {
    const calls = fakeNetwork(0);
    await patientFetch('https://x.supabase.co/rest/v1/messages', { method: 'POST', body: '{}' });
    assert.equal(calls(), 1);
  });

  test('a cancel from the caller is not retried', async () => {
    const calls = fakeNetwork(1);
    const controller = new AbortController();
    const pending = patientFetch('https://x.supabase.co/rest/v1/events', {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending);
    assert.equal(calls(), 1);
  });
});
