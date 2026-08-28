import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './ops-decision.js';
import { createOpsCookie } from './lib/ops-session.js';

function response() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('ops can request one bounded customer decision with an audited option set', async () => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.GROWTHEKO_SUPABASE_URL;
  const previousKey = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
  const previousSecret = process.env.GROWTHEKO_OPS_SESSION_SECRET;
  process.env.GROWTHEKO_SUPABASE_URL = 'https://supabase.example';
  process.env.GROWTHEKO_SUPABASE_SERVICE_KEY = 'service-key';
  process.env.GROWTHEKO_OPS_SESSION_SECRET = 'test-ops-session-secret-with-at-least-32-characters';
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.includes('/ops_decisions?') && options.method === 'POST') {
      writes.push({ type: 'decision', body: JSON.parse(options.body) });
      return Response.json([{ id: '123e4567-e89b-42d3-a456-426614174000' }]);
    }
    if (value.includes('/ops_audit_events?') && options.method === 'POST') {
      writes.push({ type: 'audit', body: JSON.parse(options.body) });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${value}`);
  };

  try {
    const res = response();
    await handler({
      method: 'POST',
      headers: {
        cookie: createOpsCookie({ secure: false }),
        origin: 'https://www.growtheko.com',
        host: 'www.growtheko.com'
      },
      body: {
        action: 'request_customer_decision',
        customer_id: '123e4567-e89b-42d3-a456-426614174001',
        task_id: 'setup-evidence',
        question: 'Which evidence source should we verify first?',
        recommendation: 'Start with analytics.',
        options: [
          { id: 'analytics', label: 'Analytics' },
          { id: 'interviews', label: 'Customer interviews' }
        ]
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(writes[0].type, 'decision');
    assert.equal(writes[0].body.status, 'open');
    assert.equal(writes[0].body.metadata.audience, 'customer');
    assert.equal(writes[0].body.metadata.customer_options.length, 2);
    assert.equal(writes[1].type, 'audit');
    assert.equal(writes[1].body.event_type, 'portal_customer_decision_requested');
    assert.equal(res.payload.external_execution_performed, false);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.GROWTHEKO_SUPABASE_URL;
    else process.env.GROWTHEKO_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
    else process.env.GROWTHEKO_SUPABASE_SERVICE_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.GROWTHEKO_OPS_SESSION_SECRET;
    else process.env.GROWTHEKO_OPS_SESSION_SECRET = previousSecret;
  }
});
