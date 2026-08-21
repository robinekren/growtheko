const MAX_TOKEN_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 30000;
const MAX_NAME_LENGTH = 160;
const MAX_NOTIFICATION_IDS = 50;
const MAX_LISTING_BUDGET = 100000000;
const PORTAL_EVENT_NAMES = new Set(['prompt_copied', 'task_opened', 'task_completed', 'support_started']);
const PORTAL_LISTINGS = {
  investinglab: {
    username: '@theinvestinglab',
    platform: 'TikTok',
    niche: 'Wealth & Finance'
  }
};

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

function listingRequestState(message) {
  const metadata = message?.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  const listingId = String(metadata.listing_id || '');
  if (!PORTAL_LISTINGS[listingId] || metadata.source !== 'portal_listing_request') return null;
  return {
    id: String(message.id || ''),
    listing_id: listingId,
    status: metadata.status === 'requested' ? 'requested' : 'withdrawn',
    created_at: message.created_at || null
  };
}

async function loadListingRequestStates(supabaseUrl, serviceKey, messageFilter) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/messages?${messageFilter}&sender_type=eq.customer&select=id,metadata,created_at&order=created_at.asc&limit=200`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!response.ok) return null;
  const messages = await response.json().catch(() => []);
  const latest = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const state = listingRequestState(message);
    if (state) latest.set(state.listing_id, state);
  }
  return latest;
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
  if (!['load', 'send', 'event', 'notifications', 'mark-read', 'listing-requests', 'listing-request', 'listing-undo'].includes(action) || !sessionToken || sessionToken.length > MAX_TOKEN_LENGTH) {
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
      `${supabaseUrl}/rest/v1/messages?${messageFilter}&message_type=eq.text&select=id,sender_type,sender_name,content,message_type,metadata,read_at,created_at&order=created_at.asc&limit=100`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (!messagesResponse.ok) return res.status(503).json({ error: 'Support unavailable.' });
    const messages = await messagesResponse.json();
    return res.status(200).json({ messages: Array.isArray(messages) ? messages : [] });
  }

  if (action === 'notifications') {
    const notificationsResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?${messageFilter}&sender_type=eq.team&message_type=eq.text&select=id,sender_name,content,message_type,metadata,read_at,created_at&order=created_at.desc&limit=50`,
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

  if (action === 'listing-requests') {
    const states = await loadListingRequestStates(supabaseUrl, serviceKey, messageFilter);
    if (!states) return res.status(503).json({ error: 'Listings unavailable.' });
    return res.status(200).json({ requests: [...states.values()] });
  }

  if (action === 'listing-request' || action === 'listing-undo') {
    const listingId = String(req.body?.listing_id || '');
    const listing = PORTAL_LISTINGS[listingId];
    const rawBudget = req.body?.budget;
    const budget = rawBudget === null || rawBudget === undefined || rawBudget === ''
      ? null
      : Number(rawBudget);
    if (!listing || (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > MAX_LISTING_BUDGET))) {
      return res.status(400).json({ error: 'Request unavailable.' });
    }

    const states = await loadListingRequestStates(supabaseUrl, serviceKey, messageFilter);
    if (!states) return res.status(503).json({ error: 'Listings unavailable.' });
    const current = states.get(listingId) || null;
    const nextStatus = action === 'listing-request' ? 'requested' : 'withdrawn';
    if (current?.status === nextStatus || (nextStatus === 'withdrawn' && !current)) {
      return res.status(200).json({ request: current || { listing_id: listingId, status: 'withdrawn' } });
    }

    const requested = nextStatus === 'requested';
    const budgetLabel = budget === null
      ? 'Not provided'
      : `$${Math.round(budget).toLocaleString('en-US')}`;
    const content = [
      requested ? 'LISTING REQUEST' : 'LISTING REQUEST WITHDRAWN',
      `Asset: ${listing.username}`,
      `Platform: ${listing.platform}`,
      `Niche: ${listing.niche}`,
      `Budget: ${budgetLabel}`,
      `Status: ${requested ? 'Requested' : 'Withdrawn'}`,
      'Source: GrowthEko Portal'
    ].join('\n');
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: 'POST',
      headers: serviceHeaders(serviceKey, {
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      }),
      body: JSON.stringify({
        application_id: applicationId,
        sender_type: 'customer',
        sender_name: customer.name || 'Customer',
        content,
        message_type: 'text',
        metadata: {
          source: 'portal_listing_request',
          listing_id: listingId,
          listing_username: listing.username,
          status: nextStatus,
          budget: budget === null ? null : Math.round(budget),
          related_request_id: requested ? null : current?.id || null
        }
      })
    });
    if (!insertResponse.ok) return res.status(503).json({ error: 'Listings unavailable.' });
    const inserted = await insertResponse.json().catch(() => []);
    const message = Array.isArray(inserted) ? inserted[0] : inserted;
    const state = listingRequestState(message);
    if (!state) return res.status(503).json({ error: 'Listings unavailable.' });
    return res.status(requested ? 201 : 200).json({ request: state });
  }

  if (action === 'event') {
    const eventName = String(req.body?.event_name || '').trim();
    const eventLabel = String(req.body?.event_label || '').trim().slice(0, 200);
    if (!PORTAL_EVENT_NAMES.has(eventName)) return res.status(400).json({ error: 'Request unavailable.' });
    const eventResponse = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: 'POST',
      headers: serviceHeaders(serviceKey, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        application_id: applicationId,
        sender_type: 'customer',
        sender_name: customer.name || 'Customer',
        content: `${eventName}${eventLabel ? `: ${eventLabel}` : ''}`,
        message_type: 'event',
        metadata: { source: 'portal_event', event_name: eventName, event_label: eventLabel || null }
      })
    });
    if (!eventResponse.ok) return res.status(503).json({ error: 'Event unavailable.' });
    return res.status(201).json({ success: true });
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
