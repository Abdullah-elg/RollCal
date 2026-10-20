// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildReportEmail, escapeHtml, type ReportForEmail } from './format.ts';

const base: ReportForEmail = {
  id: 'r1',
  created_at: '2026-10-19T20:00:00Z',
  target_type: 'message',
  target_id: 'm1',
  reason: 'harassment',
  details: 'Keeps <b>messaging</b> me',
  reporter: { id: 'u1', name: 'Abdullah', username: 'abdullahelg1' },
  reported: { id: 'u2', name: 'Sam', username: 'sam' },
  messageText: 'you <script>alert(1)</script>',
};

describe('buildReportEmail', () => {
  test('subject says what, why and who', () => {
    const { subject } = buildReportEmail(base, 'https://dash');
    assert.equal(subject, 'Report: Harassment or bullying, a chat message by Sam');
  });

  test('text has every detail', () => {
    const { text } = buildReportEmail(base, 'https://dash');
    for (const part of ['Reason: Harassment', 'Sam (@sam) · u2', 'Abdullah (@abdullahelg1) · u1', 'Message: you <script>', 'Report id: r1', 'https://dash']) {
      assert.ok(text.includes(part), part);
    }
  });

  test('html escapes what people typed', () => {
    const { html } = buildReportEmail(base, 'https://dash');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('Keeps &lt;b&gt;messaging&lt;/b&gt; me'));
  });

  test('photo link, deleted content and deleted accounts', () => {
    const photo = buildReportEmail(
      { ...base, target_type: 'photo', messageText: undefined, photoUrl: 'https://x/p?a=1&b=2', reported: null },
      'https://dash'
    );
    assert.ok(photo.html.includes('href="https://x/p?a=1&amp;b=2"'));
    assert.ok(photo.text.includes('Reported: Unknown (account deleted)'));
    assert.equal(photo.subject, 'Report: Harassment or bullying, a photo or video');
    const gone = buildReportEmail({ ...base, messageText: null }, 'https://dash');
    assert.ok(gone.text.includes('Message: (deleted)'));
  });
});

describe('escapeHtml', () => {
  test('all five characters', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
