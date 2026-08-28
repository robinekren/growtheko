import { createHash } from 'node:crypto';

const MAX_TOKEN_LENGTH = 4096;
const MAX_OPTION_ID_LENGTH = 80;
const MAX_RESOLUTION_NOTE_LENGTH = 1200;

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

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
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
    email: clean(customer?.email || payload?.customer_email, 320).toLowerCase()
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

function metadataOf(row) {
  if (row?.metadata && typeof row.metadata === 'object') return row.metadata;
  try {
    return JSON.parse(String(row?.metadata || '{}'));
  } catch {
    return {};
  }
}

function normalizeChoice(value, index) {
  const source = value && typeof value === 'object' ? value : { label: value };
  const label = clean(source.label, 240);
  if (!label) return null;
  const id = clean(source.id, MAX_OPTION_ID_LENGTH)
    || `option_${index + 1}_${createHash('sha256').update(label).digest('hex').slice(0, 8)}`;
  return {
    id,
    label,
    description: clean(source.description, 500)
  };
}

function customerChoices(row) {
  const metadata = metadataOf(row);
  const values = Array.isArray(metadata.customer_options) ? metadata.customer_options : [];
  return values.slice(0, 5).map(normalizeChoice).filter(Boolean);
}

function isCustomerDecision(row) {
  return metadataOf(row).audience === 'customer';
}

function publicOpenDecision(row) {
  const options = customerChoices(row);
  if (row?.status !== 'open' || options.length < 2) return null;
  return {
    id: clean(row.id, 80),
    task_id: clean(row.task_id, 240),
    gate: clean(row.gate, 500),
    question: clean(row.question, 1200),
    recommendation: clean(row.recommendation, 1200),
    verified_facts: Array.isArray(row.verified_facts)
      ? row.verified_facts.slice(0, 12).map(value => clean(value, 600)).filter(Boolean)
      : [],
    options,
    requested_at: row.requested_at || null
  };
}

function publicResolvedDecision(row) {
  const metadata = metadataOf(row);
  const selection = metadata.customer_selection;
  if (row?.status === 'open' || !selection || typeof selection !== 'object') return null;
  return {
    id: clean(row.id, 80),
    task_id: clean(row.task_id, 240),
    question: clean(row.question, 1200),
    selected_option: {
      id: clean(selection.id, MAX_OPTION_ID_LENGTH),
      label: clean(selection.label, 240)
    },
    resolved_at: row.resolved_at || metadata.customer_resolved_at || null
  };
}

async function fetchDecisionRows(supabaseUrl, serviceKey, customerId) {
  const query = new URLSearchParams({
    customer_id: `eq.${customerId}`,
    select: 'id,decision_key,task_id,status,gate,question,recommendation,verified_facts,requested_by,requested_at,resolution,resolved_by,resolved_at,metadata,updated_at',
    order: 'requested_at.desc',
    limit: '100'
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/ops_decisions?${query}`, {
    headers: serviceHeaders(serviceKey)
  });
  if (!response.ok) throw new Error('portal_decisions_unavailable');
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows.filter(isCustomerDecision) : [];
}

function decisionPayload(rows) {
  return {
    open: rows.map(publicOpenDecision).filter(Boolean),
    history: rows.map(publicResolvedDecision).filter(Boolean).slice(0, 20)
  };
}

async function resolveDecision(supabaseUrl, serviceKey, customer, body) {
  const decisionId = clean(body.decision_id, 80);
  const optionId = clean(body.option_id, MAX_OPTION_ID_LENGTH);
  const note = clean(body.note, MAX_RESOLUTION_NOTE_LENGTH);
  if (!decisionId || !optionId) throw new Error('invalid_selection');

  const query = new URLSearchParams({
    id: `eq.${decisionId}`,
    customer_id: `eq.${customer.id}`,
    status: 'eq.open',
    select: 'id,decision_key,task_id,status,gate,question,recommendation,verified_facts,requested_by,requested_at,resolution,resolved_by,resolved_at,metadata,updated_at',
    limit: '1'
  });
  const sourceResponse = await fetch(`${supabaseUrl}/rest/v1/ops_decisions?${query}`, {
    headers: serviceHeaders(serviceKey)
  });
  if (!sourceResponse.ok) throw new Error('decision_source_unavailable');
  const sourceRows = await sourceResponse.json().catch(() => []);
  const source = Array.isArray(sourceRows) ? sourceRows[0] : null;
  if (!source || !isCustomerDecision(source)) throw new Error('decision_not_open');

  const option = customerChoices(source).find(candidate => candidate.id === optionId);
  if (!option) throw new Error('invalid_selection');
  const now = new Date().toISOString();
  const metadata = metadataOf(source);
  const nextMetadata = {
    ...metadata,
    customer_selection: { id: option.id, label: option.label, note: note || null },
    customer_resolved_at: now,
    external_execution_performed: false
  };
  const patchQuery = new URLSearchParams({
    id: `eq.${decisionId}`,
    customer_id: `eq.${customer.id}`,
    status: 'eq.open',
    select: 'id'
  });
  const patchResponse = await fetch(`${supabaseUrl}/rest/v1/ops_decisions?${patchQuery}`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders(serviceKey),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      status: 'approved',
      resolution: `Customer selected: ${option.label}${note ? ` · ${note}` : ''}`,
      resolved_by: 'customer_portal',
      resolved_at: now,
      metadata: nextMetadata,
      updated_at: now
    })
  });
  if (!patchResponse.ok) throw new Error('decision_resolution_failed');
  const patched = await patchResponse.json().catch(() => []);
  if (!Array.isArray(patched) || !patched[0]?.id) throw new Error('decision_not_open');

  const auditResponse = await fetch(`${supabaseUrl}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(serviceKey),
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify({
      event_key: `portal-customer-decision:${decisionId}`,
      actor_type: 'customer',
      event_type: 'portal_customer_decision_resolved',
      entity_type: 'ops_decision',
      entity_id: decisionId,
      customer_id: customer.id,
      source_table: 'ops_decisions',
      source_record_id: decisionId,
      channel: 'portal',
      summary: `Customer selected a portal decision option: ${option.label}`,
      metadata: {
        task_id: clean(source.task_id, 240) || null,
        option_id: option.id,
        option_label: option.label,
        external_execution_performed: false
      },
      occurred_at: now
    })
  });
  if (!auditResponse.ok) throw new Error('decision_audit_failed');
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
  const action = clean(body.action, 20) || 'load';
  const sessionToken = clean(body.session_token, MAX_TOKEN_LENGTH);
  if (!sessionToken) return res.status(401).json({ error: 'Customer authentication required.' });
  if (!['load', 'resolve'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });

  const supabaseUrl = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const serviceKey = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'Decision ledger unavailable.' });

  try {
    const customer = await verifyCustomerSession(supabaseUrl, sessionToken);
    if (!customer?.id) return res.status(401).json({ error: 'Customer authentication failed.' });
    if (action === 'resolve') await resolveDecision(supabaseUrl, serviceKey, customer, body);
    const rows = await fetchDecisionRows(supabaseUrl, serviceKey, customer.id);
    return res.status(200).json({ decisions: decisionPayload(rows) });
  } catch (error) {
    if (['invalid_selection', 'decision_not_open'].includes(error?.message)) {
      return res.status(409).json({ error: 'This decision is no longer open. Refresh and try again.' });
    }
    console.error('portal-decisions:', error?.message || error);
    return res.status(503).json({ error: 'Decisions are temporarily unavailable.' });
  }
}

export { customerChoices, decisionPayload };
