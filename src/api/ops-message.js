import { createHash } from 'node:crypto';

import { sender } from './_mail-config.js';
import { hasOpsSession, isLocalDevelopmentRequest, isSameOrigin } from './lib/ops-session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 30000;

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
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

function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}

function operatorEmailHtml({ name, content }) {
  const firstName = clean(name, 120).split(/\s+/)[0] || 'there';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:42px 22px;color:#101528"><div style="font-family:Georgia,serif;font-size:18px;font-weight:700;letter-spacing:.16em;margin-bottom:30px">GROWTHEKO</div><p style="font-size:15px;line-height:1.7;margin:0 0 18px">Hey ${escapeHtml(firstName)},</p><div style="font-size:15px;line-height:1.75;white-space:pre-wrap">${escapeHtml(content)}</div><a href="https://www.growtheko.com/portal" style="display:inline-block;margin-top:28px;padding:13px 22px;border-radius:11px;background:#2768e8;color:#fff;text-decoration:none;font-size:13px;font-weight:700">Open your private portal</a><p style="margin:28px 0 0;color:#6e788b;font-size:12px;line-height:1.6">This message is also stored in your private GrowthEko portal. Reply there so the complete context stays connected.</p></div>`;
}

function localMessage(applicationId, content) {
  return {
    id: `local-ops-reply-${Date.now()}`,
    application_id: applicationId,
    email: 'test-customer@growtheko.local',
    sender_type: 'team',
    sender_name: 'Nora',
    content,
    message_type: 'text',
    metadata: { source: 'ops_inbox_reply', local_preview: true, delivery_email: 'not_sent' },
    read_at: null,
    created_at: new Date().toISOString()
  };
}

async function resolveApplication(base, key, applicationId) {
  const response = await fetch(
    `${base}/rest/v1/applications?id=eq.${encodeURIComponent(applicationId)}&select=id,email,first_name,last_name,preferred_name&limit=1`,
    { headers: serviceHeaders(key) }
  );
  if (!response.ok) throw new Error(`Application lookup rejected: ${response.status}`);
  return (await response.json().catch(() => []))?.[0] || null;
}

async function markCustomerMessagesRead(base, key, applicationId, now) {
  const response = await fetch(
    `${base}/rest/v1/messages?application_id=eq.${encodeURIComponent(applicationId)}&sender_type=eq.customer&message_type=eq.text&read_at=is.null`,
    {
      method: 'PATCH',
      headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ read_at: now })
    }
  );
  if (!response.ok) throw new Error(`Read state rejected: ${response.status}`);
}

async function sendEmailNotification({ email, name, content, messageId }) {
  const apiKey = clean(process.env.RESEND_API_KEY, 10000);
  if (!apiKey || !EMAIL.test(email)) return { status: 'not_configured', id: null };
  let from;
  try {
    from = sender('Nora · GrowthEko');
  } catch {
    return { status: 'not_configured', id: null };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `ops-message-${createHash('sha256').update(String(messageId)).digest('hex')}`
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'A message from Nora at GrowthEko',
      html: operatorEmailHtml({ name, content })
    })
  });
  if (!response.ok) return { status: 'failed', id: null };
  const payload = await response.json().catch(() => ({}));
  return { status: 'sent', id: clean(payload.id, 240) || null };
}

async function recordAudit({ base, key, applicationId, messageId, emailStatus, now }) {
  const eventKey = `ops-message:${messageId}`;
  const response = await fetch(`${base}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: serviceHeaders(key, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    }),
    body: JSON.stringify({
      event_key: eventKey,
      actor_type: 'robin',
      actor_id: 'ops_user',
      event_type: 'customer_message_sent',
      entity_type: 'message',
      entity_id: messageId,
      application_id: applicationId,
      source_table: 'messages',
      source_record_id: messageId,
      channel: emailStatus === 'sent' ? 'portal_email' : 'portal_inbox',
      summary: emailStatus === 'sent' ? 'Customer reply stored in portal and email notification sent' : 'Customer reply stored in portal',
      metadata: { sender_name: 'Nora', portal_stored: true, email_delivery: emailStatus },
      occurred_at: now
    })
  });
  if (!response.ok) throw new Error(`Audit rejected: ${response.status}`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!hasOpsSession(req.headers?.cookie)) return res.status(401).json({ ok: false, error: 'Session expired.' });
  if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request unavailable.' });

  const body = parseBody(req.body);
  const action = clean(body.action, 20).toLowerCase();
  const applicationId = clean(body.application_id, 140);
  const isLocal = isLocalDevelopmentRequest(req);
  if (!['send', 'mark-read'].includes(action) || (!UUID.test(applicationId) && !(isLocal && applicationId === 'local-test-customer'))) {
    return res.status(400).json({ ok: false, error: 'Conversation source is invalid.' });
  }

  const content = clean(body.content, MAX_MESSAGE_LENGTH);
  if (action === 'send' && (!content || content.length > MAX_MESSAGE_LENGTH)) {
    return res.status(400).json({ ok: false, error: 'Write a message before sending.' });
  }

  if (isLocal) {
    if (action === 'mark-read') return res.status(200).json({ ok: true, local_preview: true });
    return res.status(201).json({
      ok: true,
      message: localMessage(applicationId, content),
      delivery: { portal: 'preview', email: 'not_sent', whatsapp: 'not_connected' },
      audit: 'preview'
    });
  }

  const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!base || !key) return res.status(503).json({ ok: false, error: 'Inbox delivery is unavailable.' });

  const now = new Date().toISOString();
  try {
    const application = await resolveApplication(base, key, applicationId);
    if (!application) return res.status(404).json({ ok: false, error: 'Customer conversation was not found.' });

    if (action === 'mark-read') {
      await markCustomerMessagesRead(base, key, applicationId, now);
      return res.status(200).json({ ok: true, read_at: now });
    }

    const email = clean(application.email, 320).toLowerCase();
    const customerName = clean(application.preferred_name || `${application.first_name || ''} ${application.last_name || ''}`.trim() || 'Customer', 160);
    const insertResponse = await fetch(`${base}/rest/v1/messages`, {
      method: 'POST',
      headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({
        application_id: applicationId,
        sender_type: 'team',
        sender_name: 'Nora',
        content,
        message_type: 'text',
        metadata: {
          source: 'ops_inbox_reply',
          notification_type: 'support_reply',
          notification_title: 'New message from Nora',
          notification_target: 'chat',
          delivery_email: 'pending'
        }
      })
    });
    if (!insertResponse.ok) throw new Error(`Message insert rejected: ${insertResponse.status}`);
    const inserted = await insertResponse.json().catch(() => []);
    const stored = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!stored?.id) throw new Error('Message insert returned no source record');

    const emailDelivery = await sendEmailNotification({ email, name: customerName, content, messageId: stored.id });
    const metadata = {
      ...(stored.metadata && typeof stored.metadata === 'object' ? stored.metadata : {}),
      delivery_email: emailDelivery.status,
      resend_id: emailDelivery.id
    };
    await fetch(`${base}/rest/v1/messages?id=eq.${encodeURIComponent(stored.id)}`, {
      method: 'PATCH',
      headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ metadata })
    });
    await markCustomerMessagesRead(base, key, applicationId, now);

    let audit = 'recorded';
    try {
      await recordAudit({ base, key, applicationId, messageId: stored.id, emailStatus: emailDelivery.status, now });
    } catch (error) {
      audit = 'unavailable';
      console.error('ops-message audit:', error?.message || error);
    }

    return res.status(201).json({
      ok: true,
      message: { ...stored, email, metadata },
      delivery: { portal: 'stored', email: emailDelivery.status, whatsapp: 'not_connected' },
      audit
    });
  } catch (error) {
    console.error('ops-message:', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Message could not be delivered.' });
  }
}

export { escapeHtml as canonicalOpsMessageEscapeHtml, operatorEmailHtml as canonicalOperatorEmailHtml };
