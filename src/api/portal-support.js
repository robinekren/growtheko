const MAX_TOKEN_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 30000;
const MAX_NAME_LENGTH = 160;
const MAX_NOTIFICATION_IDS = 50;

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function expectedOrigin(req) {
  const configured = process.env.GROWTHEKO_SITE_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return null;
  const protocol = header(req, 'x-forwarded-proto') || 'https';
  return `${protocol}://${host}`;
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

function serviceHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra
  };
}

function customerFromPayload(payload) {
  const customer = payload?.customer || payload?.data?.customer || null;
  const id = customer?.id || payload?.customer_id || payload?.data?.customer_id || null;
  if (!id) return null;
  return {
    id: String(id),
    name: String(customer?.name || payload?.customer_name || 'Customer'),
    email: String(customer?.email || payload?.customer_email || '')
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
  const verifiedCustomer = customerFromPayload(authPayload);
  if (verifiedCustomer) return verifiedCustomer;

  // Some portal-auth versions return only a validity flag. In that case the
  // existing portal API resolves the customer from the same verified session.
  const portalResponse = await fetch(`${supabaseUrl}/functions/v1/portal-api/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: sessionToken })
  });
  if (!portalResponse.ok) return null;
  const portalPayload = await portalResponse.json().catch(() => ({}));
  return customerFromPayload(portalPayload);
}

function validCustomerId(value) {
  return /^[a-zA-Z0-9-]{8,128}$/.test(String(value || ''));
}

function validMessageId(value) {
  return /^[a-zA-Z0-9-]{8,128}$/.test(String(value || ''));
}

async function resolveApplicationId(supabaseUrl, serviceKey, customer) {
  let email = String(customer.email || '').trim().toLowerCase();
  if (!email) {
    const customerResponse = await fetch(
      `${supabaseUrl}/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}&select=email&limit=1`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (!customerResponse.ok) return null;
    const customers = await customerResponse.json().catch(() => []);
    email = String(customers?.[0]?.email || '').trim().toLowerCase();
  }
  if (!email) return null;

  const applicationResponse = await fetch(
    `${supabaseUrl}/rest/v1/applications?email=eq.${encodeURIComponent(email)}&select=id&order=submitted_at.desc&limit=1`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!applicationResponse.ok) return null;
  const applications = await applicationResponse.json().catch(() => []);
  const applicationId = applications?.[0]?.id;
  return validCustomerId(applicationId) ? String(applicationId) : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Request unavailable.' });
  if (!String(header(req, 'content-type') || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Request unavailable.' });
  }

  const supabaseUrl = process.env.GROWTHEKO_SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: 'Support unavailable.' });

  const action = String(req.body?.action || '');
  const sessionToken = String(req.body?.session_token || '');
  if (!['load', 'send', 'notifications', 'mark-read'].includes(action) || !sessionToken || sessionToken.length > MAX_TOKEN_LENGTH) {
    return res.status(400).json({ error: 'Request unavailable.' });
  }

  const customer = await verifyCustomerSession(supabaseUrl, sessionToken).catch(() => null);
  if (!customer || !validCustomerId(customer.id)) {
    return res.status(401).json({ error: 'Session expired.' });
  }

  const applicationId = await resolveApplicationId(supabaseUrl, serviceKey, customer).catch(() => null);
  if (!applicationId) return res.status(503).json({ error: 'Support unavailable.' });
  const messageFilter = `application_id=eq.${encodeURIComponent(applicationId)}`;

  if (action === 'load') {
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?${messageFilter}&select=id,sender_type,sender_name,content,message_type,metadata,read_at,created_at&order=created_at.asc&limit=100`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (!messagesResponse.ok) return res.status(503).json({ error: 'Support unavailable.' });
    const messages = await messagesResponse.json();
    return res.status(200).json({ messages: Array.isArray(messages) ? messages : [] });
  }

  if (action === 'notifications') {
    const notificationsResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?${messageFilter}&sender_type=eq.team&select=id,sender_name,content,message_type,metadata,read_at,created_at&order=created_at.desc&limit=50`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (!notificationsResponse.ok) return res.status(503).json({ error: 'Notifications unavailable.' });
    const notifications = await notificationsResponse.json();
    return res.status(200).json({ notifications: Array.isArray(notifications) ? notifications : [] });
  }

  if (action === 'mark-read') {
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map(value => String(value)).filter(validMessageId))]
      : [];
    if (!ids.length || ids.length > MAX_NOTIFICATION_IDS) {
      return res.status(400).json({ error: 'Request unavailable.' });
    }

    const idFilter = `id=in.(${ids.map(encodeURIComponent).join(',')})`;
    const markReadResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?${messageFilter}&sender_type=eq.team&${idFilter}`,
      {
        method: 'PATCH',
        headers: serviceHeaders(serviceKey, {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        }),
        body: JSON.stringify({ read_at: new Date().toISOString() })
      }
    );
    if (!markReadResponse.ok) return res.status(503).json({ error: 'Notifications unavailable.' });
    return res.status(200).json({ success: true, ids });
  }

  const content = String(req.body?.content || '').trim();
  const senderName = String(req.body?.sender_name || customer.name || 'Customer').trim();
  if (!content || content.length > MAX_MESSAGE_LENGTH || senderName.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: 'Request unavailable.' });
  }

  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify({
      application_id: applicationId,
      sender_type: 'customer',
      sender_name: senderName || customer.name || 'Customer',
      content,
      message_type: 'text',
      metadata: { source: 'portal_support_intake' }
    })
  });
  if (!insertResponse.ok) return res.status(503).json({ error: 'Support unavailable.' });
  const inserted = await insertResponse.json();
  const message = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!message?.id) return res.status(503).json({ error: 'Support unavailable.' });
  return res.status(201).json({ message });
}
