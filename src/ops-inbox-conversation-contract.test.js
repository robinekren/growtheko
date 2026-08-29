import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalAttentionSubject,
  canonicalFirstEmailContent,
  canonicalNoraPunctuation,
  canonicalOperatorEmailHtml,
  canonicalOpsMessageEscapeHtml,
  canonicalWithoutUnverifiedBro
} from './api/ops-message.js';
import { canonicalOperatorEmailAction } from './api/lib/operator-email-action.js';

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

test('customer avatar ring exposes the six revenue levels from the top clockwise', () => {
  assert.match(template, /customerAvatar\(level=\{rank:0\}\)/);
  assert.match(template, /Array\.from\(\{length:6\}/);
  assert.match(template, /conic-gradient\(from -90deg/);
  assert.match(template, /'#32363f','#b79a3b','#dda238','#e67f36','#84b94f','#20a96b'/);
  assert.match(template, /customerAvatar\(level\)/);
  assert.match(template, /\.customer-avatar\{[^}]*--customer-ring/);
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
  const action = canonicalOperatorEmailAction({ stage: 'context', replyTo: 'reply@growtheko.com' });
  const html = canonicalOperatorEmailHtml({ name: 'Mia', content: '<b>Private</b>', action, firstOutgoing: true });
  assert.match(html, /hey mia,/);
  assert.match(html, /&lt;b&gt;Private&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Private<\/b>/);
  assert.doesNotMatch(html, />GROWTHEKO</);
  assert.match(html, /What matters now/);
  assert.match(html, />reply<\/a>/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.doesNotMatch(html, /https:\/\/www\.growtheko\.com\/portal/);
});

test('Nora email copy uses honest attention and comma punctuation', () => {
  assert.equal(canonicalNoraPunctuation('hey robin — picking this back up'), 'hey robin, picking this back up');
  assert.equal(canonicalNoraPunctuation('hey robin - one quick thing'), 'hey robin, one quick thing');
  assert.equal(canonicalNoraPunctuation('HEY ROBIN — One Quick Thing'), 'hey robin, one quick thing');
  const followUp = canonicalAttentionSubject({ name: 'Robin', content: 'picking this back up without pressure' });
  assert.match(followUp, /^robin, (should i close this\?|did the priority change\?|is this still worth solving\?)$/);
  assert.equal(followUp, canonicalAttentionSubject({ name: 'Robin', content: 'picking this back up without pressure' }));
  assert.match(canonicalAttentionSubject({ name: 'Robin', content: 'the cleanest next step is this', stage: 'commit' }), /^robin, (your cleanest next move|the scope before you decide|everything for the next step)$/);
  assert.notEqual(
    canonicalAttentionSubject({ name: 'Robin', content: 'what are you building?', stage: 'connect' }),
    canonicalAttentionSubject({ name: 'Robin', content: 'what is blocking this?', stage: 'diagnose' })
  );
  assert.equal(canonicalAttentionSubject({ name: 'Robin', content: 'hello', threadSubject: 'Existing conversation' }), 'Re: Existing conversation');
});

test('first outbound starts with hey and unverified bro language is removed', () => {
  assert.equal(canonicalFirstEmailContent('one quick thing', 'Mia Example', true, { bro_allowed: false }), 'hey mia,\n\none quick thing');
  assert.equal(canonicalFirstEmailContent('already in the thread', 'Mia Example', false, { bro_allowed: false }), 'already in the thread');
  assert.equal(canonicalWithoutUnverifiedBro('hey mia, bro, one quick thing', { bro_allowed: false }), 'hey mia, one quick thing');
  assert.equal(canonicalWithoutUnverifiedBro('hey mia, bro, one quick thing', { bro_allowed: true }), 'hey mia, bro, one quick thing');
});

test('email action stays reply-only until explicit intent and an active canonical route coincide', () => {
  const early = canonicalOperatorEmailAction({ path: 'start_to_sale', stage: 'diagnose', replyTo: 'reply@growtheko.com' });
  assert.deepEqual([early.kind, early.label, early.href], ['reply', 'reply', 'mailto:reply@growtheko.com']);

  const noIntent = canonicalOperatorEmailAction({
    path: 'start_to_sale', stage: 'commit', latestInboundContent: 'sounds interesting', replyTo: 'reply@growtheko.com',
    commercialNextStep: { active: true, route_type: 'checkout', route: 'https://www.growtheko.com/digital-estate' }
  });
  assert.equal(noIntent.kind, 'reply');

  const checkout = canonicalOperatorEmailAction({
    path: 'start_to_sale', stage: 'commit', latestInboundContent: 'send me the link, i am ready to pay',
    commercialNextStep: { active: true, route_type: 'checkout', route: 'https://www.growtheko.com/digital-estate' }
  });
  assert.deepEqual([checkout.kind, checkout.label, checkout.href], ['checkout', 'continue', 'https://www.growtheko.com/digital-estate']);

  const unsafe = canonicalOperatorEmailAction({
    path: 'start_to_sale', stage: 'commit', latestInboundContent: 'send me the link', replyTo: 'reply@growtheko.com',
    commercialNextStep: { active: true, route_type: 'checkout', route: 'https://evil.example/checkout' }
  });
  assert.equal(unsafe.kind, 'reply');
});

test('Inbox has the minimal email status and collapsible Nora script workspace', () => {
  assert.match(template, /class="delivery-state/);
  assert.match(template, /class="delivery-check"/);
  assert.match(template, /data-script-toggle/);
  assert.match(template, /class="script-grip"/);
  assert.match(template, /script-toggle-label">Script/);
  assert.match(template, /class="script-subject"/);
  assert.match(template, /data-email-subject/);
  assert.match(template, /data-email-action/);
  assert.match(template, /class="script-next"/);
  assert.match(template, /conversation-script\{[^}]*background:transparent/);
  assert.match(template, /conversation-script\.open\{[^}]*background:rgba\(255,255,255,\.97\)/);
  assert.match(template, /data-script-stage/);
  assert.match(template, /data-script-use/);
  assert.match(template, /data-script-complete/);
  assert.match(template, /sent_after_operator_review/);
  assert.match(template, /data-open-customer360/);
  assert.match(template, /data-back-conversation/);
  assert.match(template, /requestScriptRecommendation/);
  assert.match(template, /action:'recommend'/);
  assert.match(template, /Used before · available again/);
  assert.match(template, /requestScriptDraft\(thread,true\)/);
  assert.doesNotMatch(template, /aria-disabled="\$\{sent\}"/);
  assert.doesNotMatch(template, /\$\{sent\?'disabled':''\}/);
  assert.doesNotMatch(template, /Stored in portal · email notification included/);
});
