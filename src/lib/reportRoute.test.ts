// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { alsoToSupport, canSendToHost, sentMessage, SUPPORT_ALWAYS } from './reportRoute.ts';

const base = { target: 'photo' as const, reporterId: 'guest', uploaderId: 'friend', hostId: 'host' };

describe('canSendToHost', () => {
  test('a guest reporting another guest’s photo can choose the host', () => {
    assert.equal(canSendToHost(base), true);
  });

  test('the host reporting goes to support', () => {
    assert.equal(canSendToHost({ ...base, reporterId: 'host' }), false);
  });

  test('a photo the host uploaded goes to support', () => {
    assert.equal(canSendToHost({ ...base, uploaderId: 'host' }), false);
  });

  test('only photos and videos, and only with a known host', () => {
    assert.equal(canSendToHost({ ...base, target: 'message' }), false);
    assert.equal(canSendToHost({ ...base, target: 'user' }), false);
    assert.equal(canSendToHost({ ...base, hostId: null }), false);
    assert.equal(canSendToHost({ ...base, hostId: undefined }), false);
  });

  test('an uploader whose account is gone can still be reported to the host', () => {
    assert.equal(canSendToHost({ ...base, uploaderId: null }), true);
  });
});

describe('alsoToSupport', () => {
  test('serious reasons sent to the host reach support too', () => {
    for (const reason of SUPPORT_ALWAYS) assert.equal(alsoToSupport('host', reason), true);
  });

  test('anything involving a child always reaches support', () => {
    assert.equal(alsoToSupport('host', 'child_safety'), true);
  });

  test('the matching server list', () => {
    assert.deepEqual([...SUPPORT_ALWAYS].sort(), ['child_safety', 'harassment', 'hate', 'nudity', 'violence']);
  });

  test('other reasons stay with the host', () => {
    assert.equal(alsoToSupport('host', 'spam'), false);
    assert.equal(alsoToSupport('host', 'impersonation'), false);
    assert.equal(alsoToSupport('host', 'other'), false);
    assert.equal(alsoToSupport('host', null), false);
  });

  test('support reports are already with support', () => {
    assert.equal(alsoToSupport('support', 'nudity'), false);
  });
});

describe('sentMessage', () => {
  test('support says so, also when a host report was sent to support instead', () => {
    assert.equal(sentMessage('support', 'spam'), 'Thanks. We’ll look at this within 24 hours.');
    assert.match(sentMessage('support', 'spam', 'host'), /RollCal support instead/);
  });

  test('host messages mention support only for serious reasons', () => {
    assert.match(sentMessage('host', 'nudity'), /RollCal support/);
    assert.doesNotMatch(sentMessage('host', 'spam'), /support/);
  });
});
