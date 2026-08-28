import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './founder-qa-access.js';

function request(body, origin = 'https://www.growtheko.com') {
  return {
    method: 'POST',
    headers: {
      origin,
      host: 'www.growtheko.com',
      'x-forwarded-host': 'www.growtheko.com',
      'x-forwarded-proto': 'https'
    },
    body
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function withEnvironment(run) {
  const previousFetch = global.fetch;
  const previousUrl = process.env.GROWTHEKO_SUPABASE_URL;
  const previousKey = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
  process.env.GROWTHEKO_SUPABASE_URL = 'https://supabase.example';
  process.env.GROWTHEKO_SUPABASE_SERVICE_KEY = 'service-key';
  try {
    await run();
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.GROWTHEKO_SUPABASE_URL;
    else process.env.GROWTHEKO_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
    else process.env.GROWTHEKO_SUPABASE_SERVICE_KEY = previousKey;
  }
}

test('Founder-QA access rejects cross-origin requests before session verification', async () => {
  await withEnvironment(async () => {
    let fetched = false;
    global.fetch = async () => { fetched = true; throw new Error('unexpected'); };
    const res = response();
    await handler(request({ session_token: 'valid-token' }, 'https://attacker.example'), res);
    assert.equal(res.statusCode, 403);
    assert.equal(fetched, false);
  });
});

test('Founder-QA access is returned only after verified identity and an active zero-value grant', async () => {
  await withEnvironment(async () => {
    const urls = [];
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-robin', email: 'robinekrenn@gmail.com' } });
      }
      return Response.json([{
        id: 'grant-event-1',
        event_type: 'founder_qa_access_granted',
        occurred_at: '2026-08-28T16:00:00.000Z',
        metadata: {
          active: true,
          access_class: 'founder_qa',
          target_offer_id: 'audit',
          commercial_order: false,
          paid: false,
          amount_paid: 0,
          revenue_recognized: 0
        }
      }]);
    };
    const res = response();
    await handler(request({ session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.access, {
      active: true,
      access_class: 'founder_qa',
      target_offer_id: 'audit',
      target_tier: 'GrowthEko AI Operator Audit',
      label: 'Founder QA · $0 paid',
      commercial_order: false,
      paid: false,
      amount_paid: 0,
      revenue_recognized: 0,
      granted_at: '2026-08-28T16:00:00.000Z',
      grant_event_id: 'grant-event-1'
    });
    assert.match(urls[1], /customer_id=eq\.customer-robin/);
    assert.match(urls[1], /entity_type=eq\.founder_qa_access/);
  });
});

test('latest revoke event closes Founder-QA access without changing commercial state', async () => {
  await withEnvironment(async () => {
    global.fetch = async (url) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-robin', email: 'robinekrenn@gmail.com' } });
      }
      return Response.json([{
        id: 'revoke-event-1',
        event_type: 'founder_qa_access_revoked',
        occurred_at: '2026-08-28T17:00:00.000Z',
        metadata: { active: false, access_class: 'founder_qa', target_offer_id: 'audit' }
      }]);
    };
    const res = response();
    await handler(request({ session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.access, null);
  });
});

test('Founder-QA grant cannot authorize another verified customer', async () => {
  await withEnvironment(async () => {
    let eventLookup = false;
    global.fetch = async (url) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'other-customer', email: 'customer@example.com' } });
      }
      eventLookup = true;
      return Response.json([]);
    };
    const res = response();
    await handler(request({ session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.access, null);
    assert.equal(eventLookup, false);
  });
});
