import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './portal-task-context.js';

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

test('portal task context fails closed before reading onboarding data', async () => {
  await withEnvironment(async () => {
    let fetched = false;
    global.fetch = async () => { fetched = true; throw new Error('unexpected'); };
    const res = response();
    await handler(request({ session_token: 'valid-token' }, 'https://attacker.example'), res);
    assert.equal(res.statusCode, 403);
    assert.equal(fetched, false);
  });
});

test('portal task context returns the verified customer canonical 48-answer summary', async () => {
  await withEnvironment(async () => {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-1', email: 'customer@example.com' } });
      }
      if (value.includes('/onboarding_sessions?')) {
        assert.match(value, /customer_id=eq\.customer-1/);
        return Response.json([{ id: 'session-1', status: 'completed', completed_at: '2026-08-28T10:00:00.000Z', tier: 'audit' }]);
      }
      if (value.includes('/onboarding_answers?')) {
        assert.match(value, /session_id=eq\.session-1/);
        return Response.json([
          { session_id: 'session-1', field_name: 'name', field_value: 'Robin' },
          { session_id: 'session-1', field_name: 'primary_goal', field_value: 'Ship one verified funnel.' }
        ]);
      }
      throw new Error(`unexpected URL: ${value}`);
    };
    const res = response();
    await handler(request({ session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.context.total, 48);
    assert.equal(res.payload.context.known_count, 2);
    assert.match(res.payload.context.text, /1\. Name: Robin/);
    assert.match(res.payload.context.text, /37\. Goal: Ship one verified funnel\./);
    assert.equal(res.payload.onboarding.session_id, 'session-1');
  });
});

test('portal task context returns explicit unknowns when onboarding is absent', async () => {
  await withEnvironment(async () => {
    global.fetch = async (url) => {
      if (String(url).includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-2', email: 'customer@example.com' } });
      }
      return Response.json([]);
    };
    const res = response();
    await handler(request({ session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.context.total, 48);
    assert.equal(res.payload.context.unknown_count, 48);
    assert.equal(res.payload.onboarding, null);
  });
});

test('portal task context updates only an allowed answer and appends an audit event', async () => {
  await withEnvironment(async () => {
    const writes = [];
    let answerValue = 'Old goal';
    global.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-3', email: 'customer@example.com' } });
      }
      if (value.includes('/onboarding_sessions?')) {
        return Response.json([{ id: 'session-3', status: 'completed', tier: 'sprint' }]);
      }
      if (value.includes('/onboarding_answers?') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        writes.push({ type: 'answer', body });
        answerValue = body.field_value;
        return new Response(null, { status: 204 });
      }
      if (value.includes('/onboarding_answers?') && value.includes('field_name=eq.primary_goal')) {
        return Response.json([{ field_value: 'Old goal' }]);
      }
      if (value.includes('/onboarding_answers?')) {
        return Response.json([{ session_id: 'session-3', field_name: 'primary_goal', field_value: answerValue }]);
      }
      if (value.includes('/ops_audit_events?')) {
        writes.push({ type: 'audit', body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${value}`);
    };
    const res = response();
    await handler(request({
      action: 'update',
      session_token: 'valid-token',
      field_name: 'primary_goal',
      field_value: 'One verified launch'
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(writes[0].type, 'answer');
    assert.equal(writes[0].body.field_value, 'One verified launch');
    assert.equal(writes[1].type, 'audit');
    assert.equal(writes[1].body.event_type, 'portal_profile_answer_updated');
    assert.equal(writes[1].body.metadata.previous_value, 'Old goal');
    assert.equal(writes[1].body.metadata.new_value, 'One verified launch');
    assert.match(res.payload.context.text, /Goal: One verified launch/);
  });
});
