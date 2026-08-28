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
      if (value.includes('/ops_audit_events?')) return Response.json([]);
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
    assert.equal(res.payload.review.confirmed, false);
    assert.match(res.payload.review.context_fingerprint, /^ctx_[a-f0-9]{20}$/);
    assert.equal(res.payload.review.generation_method, 'deterministic_template_no_model_call');
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

test('first portal profile edit creates a canonical onboarding session when none exists', async () => {
  await withEnvironment(async () => {
    const writes = [];
    let sessionCreated = false;
    global.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-new', email: 'new@example.com', tier: 'audit' } });
      }
      if (value.includes('/onboarding_sessions?') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        writes.push({ type: 'session', body });
        sessionCreated = true;
        return Response.json([{ id: 'session-new', ...body }]);
      }
      if (value.includes('/onboarding_sessions?')) return Response.json([]);
      if (value.includes('/onboarding_answers?') && value.includes('field_name=eq.company')) return Response.json([]);
      if (value.includes('/onboarding_answers?') && options.method === 'POST') {
        writes.push({ type: 'answer', body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      if (value.includes('/customers?') && options.method === 'PATCH') {
        writes.push({ type: 'customer', body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      if (value.includes('/onboarding_answers?')) {
        return sessionCreated
          ? Response.json([{ session_id: 'session-new', field_name: 'company', field_value: 'Example Co' }])
          : Response.json([]);
      }
      if (value.includes('/ops_audit_events?') && options.method === 'POST') {
        writes.push({ type: 'audit', body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      if (value.includes('/ops_audit_events?')) return Response.json([]);
      throw new Error(`unexpected URL: ${value}`);
    };

    const res = response();
    await handler(request({
      action: 'update',
      session_token: 'valid-token',
      field_name: 'company',
      field_value: 'Example Co'
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(writes[0].type, 'session');
    assert.equal(writes[0].body.customer_id, 'customer-new');
    assert.equal(writes[0].body.tier, 'audit');
    assert.equal(writes[1].type, 'answer');
    assert.equal(writes[2].type, 'customer');
    assert.match(res.payload.context.text, /Company: Example Co/);
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
      if (value.includes('/ops_audit_events?') && options.method === 'POST') {
        writes.push({ type: 'audit', body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      if (value.includes('/ops_audit_events?')) return Response.json([]);
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
    assert.equal(res.payload.review.confirmed, false);
  });
});

test('portal task context confirms one deterministic prompt revision and returns it as current', async () => {
  await withEnvironment(async () => {
    const writes = [];
    const events = [];
    global.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-4', email: 'customer@example.com' } });
      }
      if (value.includes('/onboarding_sessions?')) {
        return Response.json([{ id: 'session-4', status: 'completed', tier: 'architect' }]);
      }
      if (value.includes('/onboarding_answers?')) {
        return Response.json([
          { session_id: 'session-4', field_name: 'name', field_value: 'Robin' },
          { session_id: 'session-4', field_name: 'company', field_value: 'GrowthEko' }
        ]);
      }
      if (value.includes('/ops_audit_events?') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        writes.push(body);
        events.unshift({ event_type: body.event_type, metadata: body.metadata, occurred_at: body.occurred_at });
        return new Response(null, { status: 204 });
      }
      if (value.includes('/ops_audit_events?')) return Response.json(events);
      throw new Error(`unexpected URL: ${value}`);
    };

    const res = response();
    await handler(request({ action: 'confirm', session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].event_type, 'portal_profile_review_confirmed');
    assert.match(writes[0].metadata.context_fingerprint, /^ctx_[a-f0-9]{20}$/);
    assert.equal(writes[0].metadata.generation_method, 'deterministic_template_no_model_call');
    assert.equal(res.payload.review.confirmed, true);
    assert.equal(res.payload.review.context_fingerprint, writes[0].metadata.context_fingerprint);
  });
});
