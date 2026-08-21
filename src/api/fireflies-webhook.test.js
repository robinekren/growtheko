import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import handler from './fireflies-webhook.js';

function request(body, secret, signatureOverride) {
  const stream = Readable.from([body]);
  stream.method = 'POST';
  stream.headers = {
    'content-type': 'application/json',
    'x-hub-signature': signatureOverride || `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  };
  return stream;
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function setupEnv() {
  process.env.FIREFLIES_WEBHOOK_SECRET = 'test-signing-secret-that-is-long-enough';
  process.env.FIREFLIES_API_KEY = 'test-api-key';
  process.env.GROWTHEKO_SUPABASE_URL = 'https://example.supabase.co';
  process.env.GROWTHEKO_SUPABASE_SERVICE_KEY = 'test-service-key';
}

test('rejects a Fireflies webhook with an invalid signature', async () => {
  setupEnv();
  const body = JSON.stringify({ event: 'meeting.summarized', meeting_id: 'meeting_123' });
  const res = response();
  await handler(request(body, process.env.FIREFLIES_WEBHOOK_SECRET, 'sha256=invalid'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'Invalid signature.');
});

test('stores the complete transcript against matching customer applications', async () => {
  setupEnv();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://api.fireflies.ai/graphql') return new Response(JSON.stringify({ data: { transcript: {
      id: 'meeting_123', title: 'Customer review', date: 1787256000000, organizer_email: 'team@growtheko.com',
      participants: ['client@example.com', 'team@growtheko.com'], transcript_url: 'https://app.fireflies.ai/view/meeting_123', duration: 42,
      summary: { overview: 'Review', action_items: ['Next move'], short_summary: 'Review', topics_discussed: ['Growth'] },
      sentences: [{ index: 0, speaker_name: 'Client', text: 'This is the full sentence.', start_time: 1, end_time: 4 }]
    } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/applications?')) return new Response(JSON.stringify([{ id: 'application-1234', email: 'client@example.com' }]), { status: 200 });
    if (String(url).includes('/messages?')) return new Response('[]', { status: 200 });
    if (String(url).endsWith('/messages') && options.method === 'POST') return new Response('', { status: 201 });
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const body = JSON.stringify({ event: 'meeting.summarized', timestamp: Date.now(), meeting_id: 'meeting_123' });
    const res = response();
    await handler(request(body, process.env.FIREFLIES_WEBHOOK_SECRET), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { status: 'stored', customer_records: 1 });
    const insert = calls.find(call => call.url.endsWith('/messages') && call.options.method === 'POST');
    const insertedRows = JSON.parse(insert.options.body);
    assert.equal(insertedRows[0].application_id, 'application-1234');
    assert.equal(insertedRows[0].content, 'Client: This is the full sentence.');
    assert.equal(insertedRows[0].metadata.retention_class, 'customer_call_transcript_12_months');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
