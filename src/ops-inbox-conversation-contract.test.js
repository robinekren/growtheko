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
  assert.match(template, /Email\$\{esc\(deliveryLabel\)\} ·/);
  assert.match(template, /Email thread/);
});

test('operator email route is session-bound and resolves the recipient from the application', () => {
  assert.match(endpoint, /hasOpsSession/);
  assert.match(endpoint, /isSameOrigin/);
  assert.match(endpoint, /applications\?id=eq\./);
  assert.match(endpoint, /sender_type: 'team'/);
  assert.match(endpoint, /sender_name: 'Nora'/);
  assert.match(endpoint, /source: 'ops_email_reply'/);
  assert.match(endpoint, /channel: 'email'/);
  assert.match(endpoint, /ops_audit_events/);
  assert.match(endpoint, /https:\/\/api\.resend\.com\/emails/);
  assert.match(endpoint, /'In-Reply-To'/);
  assert.doesNotMatch(endpoint, /whatsapp: 'not_connected'/);
});

test('operator notification email escapes user-authored content', () => {
  assert.equal(canonicalOpsMessageEscapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#039;');
  const html = canonicalOperatorEmailHtml({ name: 'Mia', content: '<b>Private</b>' });
  assert.match(html, /Hey Mia/);
  assert.match(html, /&lt;b&gt;Private&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Private<\/b>/);
  assert.match(html, /Reply directly to this email/);
  assert.doesNotMatch(html, /https:\/\/www\.growtheko\.com\/portal/);
});

test('Inbox has the minimal email status and collapsible Nora script workspace', () => {
  assert.match(template, /class="delivery-state/);
  assert.match(template, /class="delivery-check"/);
  assert.match(template, /data-script-toggle/);
  assert.match(template, /class="script-grip"/);
  assert.match(template, /data-script-stage/);
  assert.match(template, /data-script-use/);
  assert.match(template, /data-script-complete/);
  assert.doesNotMatch(template, /Stored in portal · email notification included/);
});
