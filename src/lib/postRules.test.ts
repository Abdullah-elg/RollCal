// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mayPost, ruleOf } from './postRules.ts';

const host = 'host-id';
const sam = 'sam-id';

describe('ruleOf', () => {
  test('missing or unknown means everyone', () => {
    assert.equal(ruleOf({}, 'photos'), 'everyone');
    assert.equal(ruleOf({ photos_by: null }, 'photos'), 'everyone');
    assert.equal(ruleOf({ chat_by: 'host' }, 'chat'), 'host');
    assert.equal(ruleOf({ chat_by: 'host' }, 'photos'), 'everyone');
  });
});

describe('mayPost', () => {
  const open = { creator_id: host };
  const closed = { creator_id: host, photos_by: 'host' as const, chat_by: 'host' as const };

  test('everyone mode lets members post', () => {
    assert.equal(mayPost(open, sam, 'photos', []), true);
    assert.equal(mayPost(open, sam, 'chat', []), true);
  });
  test('host-only blocks others, not the host', () => {
    assert.equal(mayPost(closed, sam, 'photos', []), false);
    assert.equal(mayPost(closed, sam, 'chat', []), false);
    assert.equal(mayPost(closed, host, 'photos', []), true);
    assert.equal(mayPost(closed, host, 'chat', []), true);
  });
  test('allowed people get only what they were given', () => {
    const allowed = [{ user_id: sam, photos: true, chat: false }];
    assert.equal(mayPost(closed, sam, 'photos', allowed), true);
    assert.equal(mayPost(closed, sam, 'chat', allowed), false);
    assert.equal(mayPost(closed, 'other', 'photos', allowed), false);
  });
  test('signed out never posts', () => {
    assert.equal(mayPost(open, null, 'photos', []), false);
  });
});
