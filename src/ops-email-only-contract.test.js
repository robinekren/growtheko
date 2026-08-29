import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalInboundAddress,
  canonicalInboundHtmlToText,
  verifyResendWebhook
} from './api/resend-inbound.js';
import {
  START_TO_SALE_ORCHESTRATION,
  canonicalConversationSource,
  conversationScriptPrompt,
  deterministicConversationDraft,
  normalizeConversationDraft,
  normalizeConversationScriptRequest,
  recommendConversationMove
} from './api/lib/conversation-scripts.js';

const inboundEndpoint = readFileSync(new URL('./api/resend-inbound.js', import.meta.url), 'utf8');
const draftEndpoint = readFileSync(new URL('./api/ops-script.js', import.meta.url), 'utf8');
const nurtureEndpoint = readFileSync(new URL('./api/cron/nurture.js', import.meta.url), 'utf8');

test('Resend inbound requests require a recent raw-body signature', () => {
  const raw = Buffer.from('{"type":"email.received"}');
  const id = 'msg_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bytes = Buffer.from('email-only-secret');
  const secret = `whsec_${bytes.toString('base64')}`;
  const signature = createHmac('sha256', bytes).update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw])).digest('base64');
  assert.equal(verifyResendWebhook({ raw, id, timestamp, signature: `v1,${signature}`, secret }), true);
  assert.equal(verifyResendWebhook({ raw: Buffer.from('changed'), id, timestamp, signature: `v1,${signature}`, secret }), false);
});

test('inbound email is resolved, normalized and stored as a customer email', () => {
  assert.deepEqual(canonicalInboundAddress('Mia Example <MIA@example.com>'), { email: 'mia@example.com', name: 'Mia Example' });
  assert.equal(canonicalInboundHtmlToText('<p>Hello<br>Robin &amp; Nora</p>'), 'Hello\nRobin & Nora');
  assert.match(inboundEndpoint, /email\.received/);
  assert.match(inboundEndpoint, /https:\/\/api\.resend\.com\/emails\/receiving/);
  assert.match(inboundEndpoint, /sender_type: 'customer'/);
  assert.match(inboundEndpoint, /channel: 'email'/);
  assert.match(inboundEndpoint, /latestProfileContextStage/);
  assert.match(inboundEndpoint, /profile_context_answer/);
  assert.match(inboundEndpoint, /ops_audit_events/);
  assert.match(inboundEndpoint, /bodyParser: false/);
});

test('Nora scripts are draft-only, lowercase and reject fabricated commercial pressure', () => {
  const request = normalizeConversationScriptRequest({ path: 'start_to_sale', stage: 'diagnose', format: 'text' });
  const source = canonicalConversationSource({ preferred_name: 'Mia', biggest_challenge: 'Offer clarity' }, []);
  const draft = deterministicConversationDraft(source, request);
  assert.equal(draft, draft.toLowerCase());
  assert.doesNotMatch(draft, /[—–]/);
  assert.equal(normalizeConversationDraft('hey mia — what changed?', source), 'hey mia, what changed?');
  assert.equal(normalizeConversationDraft('only 2 spots left — act now', source), null);
  assert.equal(normalizeConversationDraft('bro, this is the move', source), null);
  const premiumSource = canonicalConversationSource({
    preferred_name: 'Mia',
    customer_level: { key: 'premium', rank: 3, tag: '💎 Premium', amount: '$1,997' }
  }, [{ sender_type: 'customer', content: 'bro, what do you think?', created_at: '2026-08-28T10:00:00.000Z' }]);
  assert.equal(premiumSource.relationship_tone.bro_allowed, true);
  assert.equal(normalizeConversationDraft('bro, this is the move', premiumSource), 'hey mia, bro, this is the move');
  const prompt = conversationScriptPrompt(source, request);
  assert.match(prompt.system, /relationship_tone\.bro_allowed/);
  assert.match(prompt.system, /verified premium-or-higher paid customer level/);
  const contextDraft = deterministicConversationDraft(
    canonicalConversationSource({ preferred_name: 'Mia', goal: 'Build a clear first offer.' }, []),
    normalizeConversationScriptRequest({ path: 'start_to_sale', stage: 'context', format: 'text' })
  );
  assert.doesNotMatch(contextDraft, /\.\./);
  assert.match(draftEndpoint, /draft_only: true/);
  assert.match(draftEndpoint, /auto_sent: false/);
  assert.match(draftEndpoint, /email_subject: emailSubject/);
  assert.match(draftEndpoint, /email_action: emailAction/);
  assert.doesNotMatch(draftEndpoint, /https:\/\/api\.resend\.com\/emails/);
});

test('the seven start-to-sale phases are explicit gates, not a blind send sequence', () => {
  assert.deepEqual(Object.keys(START_TO_SALE_ORCHESTRATION), [
    'connect', 'context', 'diagnose', 'clarify', 'recommend', 'commit', 'follow_up'
  ]);
  assert.deepEqual(Object.values(START_TO_SALE_ORCHESTRATION).map(item => item.order), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(START_TO_SALE_ORCHESTRATION.commit.link_gate, /checkout.*Apply.*Onboarding/i);
  assert.match(START_TO_SALE_ORCHESTRATION.follow_up.send_gate, /Never follow up immediately/i);
});

test('Nora routes each reply from the current thread and offer state', () => {
  assert.equal(recommendConversationMove(canonicalConversationSource({ preferred_name: 'Mia' }, [])).stage, 'connect');

  const waiting = recommendConversationMove(canonicalConversationSource({ goal: 'Launch' }, [
    { sender_type: 'team', content: 'what feels most urgent?', created_at: '2026-08-28T10:00:00.000Z' }
  ]), new Date('2026-08-29T09:00:00.000Z'));
  assert.equal(waiting.action, 'wait');

  const followUp = recommendConversationMove(canonicalConversationSource({ goal: 'Launch' }, [
    { sender_type: 'team', content: 'what feels most urgent?', created_at: '2026-08-25T10:00:00.000Z' }
  ]), new Date('2026-08-28T10:01:00.000Z'));
  assert.deepEqual([followUp.path, followUp.stage], ['follow_up', 'reopen']);

  const checkout = recommendConversationMove(canonicalConversationSource({
    goal: 'Launch', biggest_challenge: 'Clarity', selected_tier: 'digital_estate'
  }, [{ sender_type: 'customer', content: 'send me the link, i am ready to pay', created_at: '2026-08-28T10:00:00.000Z' }]));
  assert.deepEqual([checkout.action, checkout.stage], ['reply_now', 'commit']);

  const blockedOffer = recommendConversationMove(canonicalConversationSource({
    goal: 'Launch', biggest_challenge: 'Clarity', selected_tier: 'audit'
  }, [{ sender_type: 'customer', content: 'send me the checkout link', created_at: '2026-08-28T10:00:00.000Z' }]));
  assert.equal(blockedOffer.action, 'escalate');

  const risk = recommendConversationMove(canonicalConversationSource({ goal: 'Launch' }, [
    { sender_type: 'customer', content: 'i need a refund', created_at: '2026-08-28T10:00:00.000Z' }
  ]));
  assert.deepEqual([risk.action, risk.path], ['escalate', 'freestyle']);

  const optOut = recommendConversationMove(canonicalConversationSource({ goal: 'Launch' }, [
    { sender_type: 'customer', content: 'stop emailing me', created_at: '2026-08-28T10:00:00.000Z' }
  ]));
  assert.equal(optOut.action, 'stop');
});

test('Nora remains the disclosed sender while using verified profile context', () => {
  const request = normalizeConversationScriptRequest({ path: 'profile_context', stage: 'birthday', format: 'text' });
  const source = canonicalConversationSource({ preferred_name: 'Mia', profile_context: {} }, []);
  const draft = deterministicConversationDraft(source, request);
  assert.match(draft, /optional profile detail/);
  assert.match(draft, /would you like to share/);
  assert.doesNotMatch(draft, /robin wrote|from robin|i am robin/i);
  assert.match(draftEndpoint, /draft_only: true/);
});

test('scheduled emails use the same email-only message ledger', () => {
  assert.match(nurtureEndpoint, /deliverTrackedEmail/);
  assert.match(nurtureEndpoint, /rest\/v1\/messages/);
  assert.match(nurtureEndpoint, /channel: 'email'/);
  assert.match(nurtureEndpoint, /delivery_email: 'pending'/);
  assert.match(nurtureEndpoint, /customer_email_sent/);
  assert.match(nurtureEndpoint, /GROWTHEKO_INBOUND_EMAIL/);
  assert.doesNotMatch(nurtureEndpoint, /Last few spots|Last Spot|Enter Before It Closes|are you still serious/i);
});
