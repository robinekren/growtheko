import { createHash } from 'node:crypto';

import { CUSTOMER_INTAKE_FIELDS, canonicalCustomerIntakeSummary } from './lib/customer-intake-summary.js';

const MAX_TOKEN_LENGTH = 4096;
const MAX_VALUE_LENGTH = 4000;
const EDITABLE_FIELDS = new Set(CUSTOMER_INTAKE_FIELDS.map(field => field.key));

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function expectedOrigin(req) {
  const configured = process.env.GROWTHEKO_SITE_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return null;
  return `${header(req, 'x-forwarded-proto') || 'https'}://${host}`;
}

function isSameOrigin(req) {
  const origin = header(req, 'origin');
  const expected = expectedOrigin(req);
  if (!origin || !expected) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) return body;
  try {
    const parsed = JSON.parse(String(body || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

function customerFromPayload(payload) {
  const customer = payload?.customer || payload?.data?.customer || null;
  const id = customer?.id || payload?.customer_id || payload?.data?.customer_id || null;
  if (!id) return null;
  return {
    id: String(id),
    email: String(customer?.email || payload?.customer_email || '').trim().toLowerCase()
  };
}

async function verifyCustomerSession(supabaseUrl, sessionToken) {
  const authResponse = await fetch(`${supabaseUrl}/functions/v1/portal-auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: sessionToken })
  });
  if (!authResponse.ok) return null;

  const authPayload = await authResponse.json().catch(() => ({}));
  const verified = customerFromPayload(authPayload);
  if (verified?.id) return verified;

  const portalResponse = await fetch(`${supabaseUrl}/functions/v1/portal-api/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: sessionToken })
  });
  if (!portalResponse.ok) return null;
  return customerFromPayload(await portalResponse.json().catch(() => ({})));
}

async function fetchRows(url, serviceKey) {
  const response = await fetch(url, { headers: serviceHeaders(serviceKey) });
  if (!response.ok) throw new Error('task_context_unavailable');
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function latestOnboardingSession(supabaseUrl, serviceKey, customerId) {
  const query = new URLSearchParams({
    customer_id: `eq.${customerId}`,
    select: 'id,status,completed_at,started_at,tier',
    order: 'completed_at.desc.nullslast,started_at.desc',
    limit: '1'
  });
  const rows = await fetchRows(`${supabaseUrl}/rest/v1/onboarding_sessions?${query}`, serviceKey);
  return rows[0] || null;
}

async function onboardingAnswers(supabaseUrl, serviceKey, sessionId) {
  const query = new URLSearchParams({
    session_id: `eq.${sessionId}`,
    select: 'session_id,field_name,field_value',
    order: 'field_name.asc',
    limit: '200'
  });
  return fetchRows(`${supabaseUrl}/rest/v1/onboarding_answers?${query}`, serviceKey);
}

async function updateOnboardingAnswer(supabaseUrl, serviceKey, { customerId, sessionId, fieldName, fieldValue }) {
  const currentQuery = new URLSearchParams({
    session_id: `eq.${sessionId}`,
    field_name: `eq.${fieldName}`,
    select: 'field_value',
    limit: '1'
  });
  const currentRows = await fetchRows(`${supabaseUrl}/rest/v1/onboarding_answers?${currentQuery}`, serviceKey);
  const previousValue = currentRows[0]?.field_value ?? null;

  const answerResponse = await fetch(
    `${supabaseUrl}/rest/v1/onboarding_answers?on_conflict=session_id,field_name`,
    {
      method: 'POST',
      headers: {
        ...serviceHeaders(serviceKey),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ session_id: sessionId, field_name: fieldName, field_value: fieldValue })
    }
  );
  if (!answerResponse.ok) throw new Error('answer_update_failed');

  if (fieldName === 'name' || fieldName === 'company') {
    const customerResponse = await fetch(`${supabaseUrl}/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders(serviceKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [fieldName]: fieldValue, last_activity_at: new Date().toISOString() })
    });
    if (!customerResponse.ok) throw new Error('customer_update_failed');
  }

  const occurredAt = new Date().toISOString();
  const revisionHash = createHash('sha256')
    .update(JSON.stringify([sessionId, fieldName, previousValue, fieldValue, occurredAt]))
    .digest('hex')
    .slice(0, 24);
  const auditResponse = await fetch(`${supabaseUrl}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(serviceKey),
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify({
      event_key: `portal-profile-edit:${revisionHash}`,
      actor_type: 'customer',
      event_type: 'portal_profile_answer_updated',
      entity_type: 'onboarding_session',
      entity_id: sessionId,
      customer_id: customerId,
      source_table: 'onboarding_answers',
      source_record_id: `${sessionId}:${fieldName}`,
      channel: 'portal',
      summary: 'Customer updated a portal profile answer',
      metadata: {
        field_name: fieldName,
        previous_value: previousValue,
        new_value: fieldValue,
        customer_confirmed: true
      },
      occurred_at: occurredAt
    })
  });
  if (!auditResponse.ok) throw new Error('answer_audit_failed');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Request unavailable.' });

  const body = parseBody(req.body);
  const sessionToken = String(body.session_token || '');
  if (!sessionToken || sessionToken.length > MAX_TOKEN_LENGTH) {
    return res.status(401).json({ error: 'Customer authentication required.' });
  }

  const supabaseUrl = process.env.GROWTHEKO_SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'Task context unavailable.' });

  try {
    const customer = await verifyCustomerSession(supabaseUrl, sessionToken);
    if (!customer?.id) return res.status(401).json({ error: 'Customer authentication failed.' });

    const session = await latestOnboardingSession(supabaseUrl, serviceKey, customer.id);
    if (!session?.id) {
      return res.status(200).json({
        context: canonicalCustomerIntakeSummary([]),
        onboarding: null
      });
    }

    const action = String(body.action || 'load');
    if (!['load', 'update'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });
    if (action === 'update') {
      const fieldName = String(body.field_name || '').trim();
      const fieldValue = String(body.field_value ?? '').trim();
      if (!EDITABLE_FIELDS.has(fieldName)) return res.status(400).json({ error: 'This field cannot be edited.' });
      if (fieldValue.length > MAX_VALUE_LENGTH) return res.status(400).json({ error: 'This answer is too long.' });
      await updateOnboardingAnswer(supabaseUrl, serviceKey, {
        customerId: customer.id,
        sessionId: session.id,
        fieldName,
        fieldValue
      });
    }

    const answers = await onboardingAnswers(supabaseUrl, serviceKey, session.id);
    return res.status(200).json({
      context: canonicalCustomerIntakeSummary(answers, { sessionId: session.id }),
      onboarding: {
        session_id: session.id,
        status: session.status || null,
        completed_at: session.completed_at || null,
        tier: session.tier || null
      }
    });
  } catch {
    return res.status(503).json({ error: 'Task context unavailable.' });
  }
}
