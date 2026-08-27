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
  canonicalConversationSource,
  deterministicConversationDraft,
  normalizeConversationDraft,
  normalizeConversationScriptRequest
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
  assert.match(inboundEndpoint, /ops_audit_events/);
  assert.match(inboundEndpoint, /bodyParser: false/);
});

test('Nora scripts are draft-only, lowercase and reject fabricated commercial pressure', () => {
  const request = normalizeConversationScriptRequest({ path: 'start_to_sale', stage: 'diagnose', format: 'text' });
  const source = canonicalConversationSource({ preferred_name: 'Mia', biggest_challenge: 'Offer clarity' }, []);
  const draft = deterministicConversationDraft(source, request);
  assert.equal(draft, draft.toLowerCase());
  assert.equal(normalizeConversationDraft('only 2 spots left — act now', source), null);
  assert.match(draftEndpoint, /draft_only: true/);
  assert.match(draftEndpoint, /auto_sent: false/);
  assert.doesNotMatch(draftEndpoint, /https:\/\/api\.resend\.com\/emails/);
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
