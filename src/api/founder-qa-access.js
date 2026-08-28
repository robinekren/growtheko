const MAX_TOKEN_LENGTH = 4096;
const FOUNDER_QA_EMAIL = 'robinekrenn@gmail.com';
const ACCESS_CLASS = 'founder_qa';
const TARGET_OFFER_ID = 'audit';
const ACCESS_EVENT_TYPES = 'in.(founder_qa_access_granted,founder_qa_access_revoked)';

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
  if (verified?.email) return verified;

  const portalResponse = await fetch(`${supabaseUrl}/functions/v1/portal-api/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: sessionToken })
  });
  if (!portalResponse.ok) return null;
  return customerFromPayload(await portalResponse.json().catch(() => ({})));
}

async function loadLatestAccessEvent(supabaseUrl, serviceKey, customerId) {
  const query = new URLSearchParams({
    select: 'id,event_key,event_type,metadata,occurred_at',
    customer_id: `eq.${customerId}`,
    entity_type: 'eq.founder_qa_access',
    event_type: ACCESS_EVENT_TYPES,
    order: 'occurred_at.desc',
    limit: '1'
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/ops_audit_events?${query}`, {
    headers: serviceHeaders(serviceKey)
  });
  if (!response.ok) throw new Error('access_event_unavailable');
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function activeFounderGrant(event) {
  const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (event?.event_type !== 'founder_qa_access_granted') return null;
  if (
    metadata.active !== true ||
    metadata.access_class !== ACCESS_CLASS ||
    metadata.target_offer_id !== TARGET_OFFER_ID ||
    metadata.commercial_order !== false ||
    metadata.paid !== false ||
    Number(metadata.amount_paid) !== 0 ||
    Number(metadata.revenue_recognized) !== 0
  ) return null;

  return {
    active: true,
    access_class: ACCESS_CLASS,
    target_offer_id: TARGET_OFFER_ID,
    target_tier: 'GrowthEko AI Operator Audit',
    label: 'Founder QA · $0 paid',
    commercial_order: false,
    paid: false,
    amount_paid: 0,
    revenue_recognized: 0,
    granted_at: event.occurred_at || null,
    grant_event_id: event.id || null
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
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
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'Access verification unavailable.' });

  try {
    const customer = await verifyCustomerSession(supabaseUrl, sessionToken);
    if (!customer?.id) return res.status(401).json({ error: 'Customer authentication failed.' });
    if (customer.email !== FOUNDER_QA_EMAIL) return res.status(200).json({ access: null });

    const event = await loadLatestAccessEvent(supabaseUrl, serviceKey, customer.id);
    return res.status(200).json({ access: activeFounderGrant(event) });
  } catch {
    return res.status(503).json({ error: 'Access verification unavailable.' });
  }
}
