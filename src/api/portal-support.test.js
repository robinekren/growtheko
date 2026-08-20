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
        return Response.json({ customer: { id: 'own-customer-123', name: 'Customer', email: 'owner@example.com' } });
      }
      if (String(url).includes('/rest/v1/applications')) {
        assert.match(String(url), /email=eq\.owner%40example\.com/);
        return Response.json([{ id: 'own-application-123' }]);
      }
      assert.match(String(url), /application_id=eq\.own-application-123/);
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
    assert.equal(urls.length, 3);
  });
});

test('stores a support request under the verified customer only', async () => {
  await withSupportEnvironment(async () => {
    let insertedBody;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Verified Customer', email: 'owner@example.com' } });
      }
      if (String(url).includes('/rest/v1/applications')) {
        return Response.json([{ id: 'own-application-123' }]);
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
    assert.equal(insertedBody.application_id, 'own-application-123');
    assert.equal(insertedBody.sender_type, 'customer');
  });
});

test('loads only team notifications for the verified customer', async () => {
  await withSupportEnvironment(async () => {
    let notificationUrl = '';
    global.fetch = async (url) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Verified Customer', email: 'owner@example.com' } });
      }
      if (String(url).includes('/rest/v1/applications')) {
        return Response.json([{ id: 'own-application-123' }]);
      }
      notificationUrl = String(url);
      return Response.json([{ id: 'message-123', sender_type: 'team', content: 'Update' }]);
    };
    const res = response();
    await handler(request({ action: 'notifications', session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.notifications.length, 1);
    assert.match(notificationUrl, /application_id=eq\.own-application-123/);
    assert.match(notificationUrl, /sender_type=eq\.team/);
    assert.match(notificationUrl, /read_at/);
  });
});

test('marks selected team notifications read for the verified customer only', async () => {
  await withSupportEnvironment(async () => {
    let patchUrl = '';
    let patchBody = null;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Verified Customer', email: 'owner@example.com' } });
      }
      if (String(url).includes('/rest/v1/applications')) {
        return Response.json([{ id: 'own-application-123' }]);
      }
      patchUrl = String(url);
      patchBody = JSON.parse(options.body);
      return new Response(null, { status: 204 });
    };
    const res = response();
    await handler(request({
      action: 'mark-read',
      session_token: 'valid-token',
      ids: ['message-123', 'message-456']
    }), res);
    assert.equal(res.statusCode, 200);
    assert.match(patchUrl, /application_id=eq\.own-application-123/);
    assert.match(patchUrl, /sender_type=eq\.team/);
    assert.match(patchUrl, /id=in\.\(message-123,message-456\)/);
    assert.ok(patchBody.read_at);
  });
});

test('creates a verified listing request ticket with the portal budget', async () => {
  await withSupportEnvironment(async () => {
    let insertedBody = null;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Verified Customer', email: 'owner@example.com' } });
      }
      if (String(url).includes('/rest/v1/applications')) {
        return Response.json([{ id: 'own-application-123' }]);
      }
      if (!options.method) return Response.json([]);
      insertedBody = JSON.parse(options.body);
      return Response.json([{
        id: 'listing-message-123',
        created_at: '2026-08-20T12:00:00.000Z',
        ...insertedBody
      }]);
    };
    const res = response();
    await handler(request({
      action: 'listing-request',
      session_token: 'valid-token',
      listing_id: 'investinglab',
      budget: 5000
    }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(insertedBody.application_id, 'own-application-123');
    assert.equal(insertedBody.metadata.source, 'portal_listing_request');
    assert.equal(insertedBody.metadata.status, 'requested');
    assert.equal(insertedBody.metadata.budget, 5000);
    assert.match(insertedBody.content, /Asset: @theinvestinglab/);
    assert.equal(res.payload.request.status, 'requested');
  });
});

test('withdraws an active listing request without deleting its audit trail', async () => {
  await withSupportEnvironment(async () => {
    let insertedBody = null;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'own-customer-123', name: 'Verified Customer', email: 'owner@example.com' } });
      }
      if (String(url).includes('/rest/v1/applications')) {
        return Response.json([{ id: 'own-application-123' }]);
      }
      if (!options.method) {
        return Response.json([{
          id: 'listing-message-123',
          created_at: '2026-08-20T12:00:00.000Z',
          metadata: { source: 'portal_listing_request', listing_id: 'investinglab', status: 'requested' }
        }]);
      }
      insertedBody = JSON.parse(options.body);
      return Response.json([{
        id: 'listing-message-456',
        created_at: '2026-08-20T12:05:00.000Z',
        ...insertedBody
      }]);
    };
    const res = response();
    await handler(request({
      action: 'listing-undo',
      session_token: 'valid-token',
      listing_id: 'investinglab',
      budget: 5000
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(insertedBody.metadata.status, 'withdrawn');
    assert.equal(insertedBody.metadata.related_request_id, 'listing-message-123');
    assert.match(insertedBody.content, /LISTING REQUEST WITHDRAWN/);
    assert.equal(res.payload.request.status, 'withdrawn');
  });
});
