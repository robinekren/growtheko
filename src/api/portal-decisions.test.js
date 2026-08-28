import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './portal-decisions.js';

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

function customerDecision(overrides = {}) {
  return {
    id: 'decision-1',
    decision_key: 'customer:key',
    task_id: 'setup-evidence',
    status: 'open',
    gate: 'Choose one evidence source',
    question: 'Which source should we verify first?',
    recommendation: 'Start with analytics.',
    verified_facts: ['The funnel is live.'],
    requested_by: 'nora',
    requested_at: '2026-08-28T12:00:00.000Z',
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    metadata: {
      audience: 'customer',
      customer_options: [
        { id: 'analytics', label: 'Analytics', description: 'Use the measured funnel data.' },
        { id: 'interviews', label: 'Customer interviews' }
      ]
    },
    updated_at: '2026-08-28T12:00:00.000Z',
    ...overrides
  };
}

test('portal decisions fail closed before reading the decision ledger', async () => {
  await withEnvironment(async () => {
    let fetched = false;
    global.fetch = async () => { fetched = true; throw new Error('unexpected'); };
    const res = response();
    await handler(request({ session_token: 'valid-token' }, 'https://attacker.example'), res);
    assert.equal(res.statusCode, 403);
    assert.equal(fetched, false);
  });
});

test('portal decisions expose only customer-scoped open and resolved choices', async () => {
  await withEnvironment(async () => {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-1', email: 'customer@example.com' } });
      }
      if (value.includes('/ops_decisions?')) {
        return Response.json([
          customerDecision(),
          customerDecision({ id: 'robin-only', metadata: { audience: 'robin', customer_options: ['Yes', 'No'] } }),
          customerDecision({
            id: 'decision-2',
            status: 'approved',
            resolved_at: '2026-08-28T13:00:00.000Z',
            metadata: { audience: 'customer', customer_selection: { id: 'analytics', label: 'Analytics' } }
          })
        ]);
      }
      throw new Error(`unexpected URL: ${value}`);
    };
    const res = response();
    await handler(request({ action: 'load', session_token: 'valid-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.decisions.open.length, 1);
    assert.equal(res.payload.decisions.history.length, 1);
    assert.deepEqual(res.payload.decisions.open[0].options.map(option => option.id), ['analytics', 'interviews']);
    assert.equal('metadata' in res.payload.decisions.open[0], false);
  });
});

test('portal decision resolution validates the option, stores it and appends an audit event', async () => {
  await withEnvironment(async () => {
    const writes = [];
    let resolved = false;
    global.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-1', email: 'customer@example.com' } });
      }
      if (value.includes('/ops_decisions?') && options.method === 'PATCH') {
        const body = JSON.parse(options.body);
        writes.push({ type: 'decision', body });
        resolved = true;
        return Response.json([{ id: 'decision-1' }]);
      }
      if (value.includes('/ops_audit_events?') && options.method === 'POST') {
        writes.push({ type: 'audit', body: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      }
      if (value.includes('/ops_decisions?') && value.includes('status=eq.open')) {
        return Response.json(resolved ? [] : [customerDecision()]);
      }
      if (value.includes('/ops_decisions?')) {
        return Response.json(resolved
          ? [customerDecision({
              status: 'approved',
              resolved_at: '2026-08-28T13:00:00.000Z',
              metadata: { audience: 'customer', customer_selection: { id: 'analytics', label: 'Analytics' } }
            })]
          : [customerDecision()]);
      }
      throw new Error(`unexpected URL: ${value}`);
    };

    const res = response();
    await handler(request({
      action: 'resolve',
      session_token: 'valid-token',
      decision_id: 'decision-1',
      option_id: 'analytics'
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(writes[0].type, 'decision');
    assert.equal(writes[0].body.status, 'approved');
    assert.equal(writes[0].body.metadata.customer_selection.label, 'Analytics');
    assert.equal(writes[1].type, 'audit');
    assert.equal(writes[1].body.event_type, 'portal_customer_decision_resolved');
    assert.equal(writes[1].body.metadata.external_execution_performed, false);
    assert.equal(res.payload.decisions.open.length, 0);
    assert.equal(res.payload.decisions.history[0].selected_option.label, 'Analytics');
  });
});

test('portal decision resolution rejects an option outside the customer-scoped choice set', async () => {
  await withEnvironment(async () => {
    let mutationAttempted = false;
    global.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.includes('/portal-auth/verify')) {
        return Response.json({ customer: { id: 'customer-1', email: 'customer@example.com' } });
      }
      if (value.includes('/ops_decisions?') && value.includes('status=eq.open') && !options.method) {
        return Response.json([customerDecision()]);
      }
      if (options.method === 'PATCH' || value.includes('/ops_audit_events?')) mutationAttempted = true;
      throw new Error(`unexpected URL: ${value}`);
    };

    const res = response();
    await handler(request({
      action: 'resolve',
      session_token: 'valid-token',
      decision_id: 'decision-1',
      option_id: 'not-offered'
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(mutationAttempted, false);
  });
});
