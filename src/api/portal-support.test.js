import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './portal-support.js';

function request(body, origin = 'https://www.growtheko.com') {
  return {
    method: 'POST',
    headers: {
      origin,
      host: 'www.growtheko.com',
      'x-forwarded-host': 'www.growtheko.com',
      'x-forwarded-proto': 'https',
      'content-type': 'application/json'
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

async function withSupportEnvironment(run) {
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

test('rejects cross-origin support requests before session lookup', async () => {
  await withSupportEnvironment(async () => {
    let fetched = false;
    global.fetch = async () => { fetched = true; throw new Error('unexpected'); };
    const res = response();
    await handler(request({ action: 'load', session_token: 'token' }, 'https://attacker.example'), res);
    assert.equal(res.statusCode, 403);
    assert.equal(fetched, false);
  });
});

test('loads messages only for the customer resolved from the verified session', async () => {
  await withSupportEnvironment(async () => {
    const urls = [];
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Customer' } });
      }
      assert.match(String(url), /application_id=eq\.own-customer-123/);
      assert.doesNotMatch(String(url), /other-customer/);
      return Response.json([]);
    };
    const res = response();
    await handler(request({
      action: 'load',
      session_token: 'valid-token',
      application_id: 'other-customer'
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { messages: [] });
    assert.equal(urls.length, 2);
  });
});

test('stores a support request under the verified customer only', async () => {
  await withSupportEnvironment(async () => {
    let insertedBody;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Verified Customer' } });
      }
      insertedBody = JSON.parse(options.body);
      return Response.json([{ id: 'message-123', ...insertedBody }]);
    };
    const res = response();
    await handler(request({
      action: 'send',
      session_token: 'valid-token',
      application_id: 'other-customer',
      content: 'Structured support request',
      sender_name: 'Customer'
    }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(insertedBody.application_id, 'own-customer-123');
    assert.equal(insertedBody.sender_type, 'customer');
  });
});
