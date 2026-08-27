import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalOperatorEmailHtml,
  canonicalOpsMessageEscapeHtml
} from './api/ops-message.js';

const template = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('./api/ops-message.js', import.meta.url), 'utf8');

test('Inbox opens one fixed conversation workspace instead of a second CRM', () => {
  assert.match(template, /class="conversation-stack"/);
  assert.match(template, /class="conversation-context"/);
  assert.match(template, /class="conversation-shell"/);
  assert.match(template, /data-conversation-messages/);
  assert.match(template, /data-conversation-form/);
  assert.match(template, /has-inbox-detail/);
  assert.match(template, /overflow-y:auto/);
  assert.match(template, /Open Customer 360/);
});

test('conversation visually separates the customer from Nora', () => {
  assert.match(template, /class="customer-avatar"/);
  assert.match(template, /chat-line \$\{team\?'team':'customer'\}/);
  assert.match(template, /team\?'Nora'/);
  assert.match(template, /linear-gradient\(145deg,#dff3ff,#ffe2ed\)/);
  assert.match(template, /chat-line\.team \.chat-bubble/);
});

test('operator send route is session-bound and resolves the recipient from the application', () => {
  assert.match(endpoint, /hasOpsSession/);
  assert.match(endpoint, /isSameOrigin/);
  assert.match(endpoint, /applications\?id=eq\./);
  assert.match(endpoint, /sender_type: 'team'/);
  assert.match(endpoint, /sender_name: 'Nora'/);
  assert.match(endpoint, /notification_type: 'support_reply'/);
  assert.match(endpoint, /ops_audit_events/);
  assert.match(endpoint, /https:\/\/api\.resend\.com\/emails/);
  assert.match(endpoint, /whatsapp: 'not_connected'/);
});

test('operator notification email escapes user-authored content', () => {
  assert.equal(canonicalOpsMessageEscapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#039;');
  const html = canonicalOperatorEmailHtml({ name: 'Mia', content: '<b>Private</b>' });
  assert.match(html, /Hey Mia/);
  assert.match(html, /&lt;b&gt;Private&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Private<\/b>/);
  assert.match(html, /https:\/\/www\.growtheko\.com\/portal/);
});
