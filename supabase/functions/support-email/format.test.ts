// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAckEmail, buildTicketEmail, ticketRef, type TicketForEmail } from './format.ts';

const base: TicketForEmail = {
  id: 'c7ea6e60-0be2-4b53-b4a6-a795f06ccd7a',
  created_at: '2026-10-19T20:00:00Z',
  category: 'account',
  message: 'Please change my email\nto <new@example.com>',
  contact_email: 'sam@example.com',
  app_info: { platform: 'ios', os: '26.1', version: '1.0.0' },
  user: { id: 'u1', name: 'Sam Rivera', username: 'samrivera' },
};

describe('ticketRef', () => {
  test('first 8 hex characters, upper case', () => {
    assert.equal(ticketRef(base.id), '#C7EA6E60');
  });
});

describe('buildTicketEmail', () => {
  test('subject names the ticket, topic and person', () => {
    assert.equal(
      buildTicketEmail(base).subject,
      'Support #C7EA6E60: Account change from Sam Rivera (@samrivera)'
    );
  });

  test('text has the message and how to reply', () => {
    const { text } = buildTicketEmail(base);
    assert.ok(text.includes('Please change my email\nto <new@example.com>'));
    assert.ok(text.includes('Email: sam@example.com'));
    assert.ok(text.includes('App: platform ios, os 26.1, version 1.0.0'));
    assert.ok(text.includes('Reply to this email to answer Sam Rivera at sam@example.com.'));
  });

  test('html escapes the message', () => {
    const { html } = buildTicketEmail(base);
    assert.ok(html.includes('&lt;new@example.com&gt;'));
    assert.ok(!html.includes('<new@example.com>'));
  });

  test('deleted account and no email', () => {
    const { subject, text } = buildTicketEmail({ ...base, user: null, contact_email: null, app_info: {} });
    assert.equal(subject, 'Support #C7EA6E60: Account change from Deleted account');
    assert.ok(text.includes('There is no email on this account to reply to.'));
    assert.ok(!text.includes('App:'));
  });
});

describe('buildAckEmail', () => {
  test('greets by first name and quotes the ticket', () => {
    const { subject, text, html } = buildAckEmail(base, 'Sam');
    assert.equal(subject, 'We got your message #C7EA6E60');
    assert.ok(text.startsWith('Hi Sam,'));
    assert.ok(text.includes('Your message (Account change, #C7EA6E60):\nPlease change my email'));
    assert.ok(text.includes('keep #C7EA6E60 in the subject'));
    assert.ok(html.includes('&lt;new@example.com&gt;'));
    assert.ok(!html.includes('<new@example.com>'));
  });

  test('no name', () => {
    assert.ok(buildAckEmail(base, null).text.startsWith('Hi,'));
  });

  test('a name with markup is escaped', () => {
    assert.ok(buildAckEmail(base, '<b>Sam</b>').html.includes('Hi &lt;b&gt;Sam&lt;/b&gt;,'));
  });
});
