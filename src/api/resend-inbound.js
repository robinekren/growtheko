import { createHmac, timingSafeEqual } from 'node:crypto';
import { profileAnswerFromReply } from './lib/customer-profile.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_WEBHOOK_BYTES) throw new Error('payload_too_large');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function webhookSecret(value) {
  const secret = clean(value, 1000);
  const encoded = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  try {
    const decoded = Buffer.from(encoded, 'base64');
    return decoded.length ? decoded : null;
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'base64');
  const b = Buffer.from(String(right || ''), 'base64');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function verifyResendWebhook({ raw, id, timestamp, signature, secret, now = Date.now() }) {
  const timestampNumber = Number(timestamp);
  const secretBytes = webhookSecret(secret);
  if (!Buffer.isBuffer(raw) || !id || !Number.isFinite(timestampNumber) || !signature || !secretBytes) return false;
  if (Math.abs(Math.floor(now / 1000) - timestampNumber) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw]);
  const expected = createHmac('sha256', secretBytes).update(signed).digest('base64');
  return String(signature).split(/\s+/).some(part => {
    const [version, supplied] = part.split(',', 2);
    return version === 'v1' && safeEqual(expected, supplied);
  });
}

function address(value) {
  if (value && typeof value === 'object') {
    return { email: clean(value.email, 320).toLowerCase(), name: clean(value.name, 160) };
  }
  const raw = clean(value, 500);
  const angle = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return angle
    ? { email: clean(angle[2], 320).toLowerCase(), name: clean(angle[1].replace(/^['"]|['"]$/g, ''), 160) }
    : { email: raw.toLowerCase(), name: '' };
}

function header(headers, name) {
  if (Array.isArray(headers)) {
    const item = headers.find(entry => clean(entry?.name, 100).toLowerCase() === name.toLowerCase());
    return clean(item?.value, 2000);
  }
  if (headers && typeof headers === 'object') {
    const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
    return clean(key ? headers[key] : '', 2000);
  }
  return '';
}

function htmlToText(value) {
  return clean(value, 100000)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 30000);
}

async function receivingEmail(apiKey, emailId) {
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) throw new Error(`Receiving API rejected: ${response.status}`);
  return response.json();
}

async function applicationForSender(base, key, email) {
  const params = new URLSearchParams({ email: `eq.${email}`, select: 'id,email', order: 'created_at.desc', limit: '1' });
  const response = await fetch(`${base}/rest/v1/applications?${params}`, { headers: serviceHeaders(key) });
  if (!response.ok) throw new Error(`Application lookup rejected: ${response.status}`);
  return (await response.json().catch(() => []))?.[0] || null;
}

async function existingMessage(base, key, applicationId, resendEmailId) {
  const params = new URLSearchParams({
    application_id: `eq.${applicationId}`,
    'metadata->>resend_email_id': `eq.${resendEmailId}`,
    select: 'id',
    limit: '1'
  });
  const response = await fetch(`${base}/rest/v1/messages?${params}`, { headers: serviceHeaders(key) });
  if (!response.ok) throw new Error(`Inbound idempotency lookup rejected: ${response.status}`);
  return (await response.json().catch(() => []))?.[0] || null;
}

async function latestProfileContextStage(base, key, applicationId) {
  const params = new URLSearchParams({
    application_id: `eq.${applicationId}`,
    sender_type: 'eq.team',
    message_type: 'eq.text',
    select: 'metadata,created_at',
    order: 'created_at.desc',
    limit: '1'
  });
  const response = await fetch(`${base}/rest/v1/messages?${params}`, { headers: serviceHeaders(key) });
  if (!response.ok) return '';
  const metadata = (await response.json().catch(() => []))?.[0]?.metadata;
  const progress = metadata && typeof metadata === 'object' ? metadata.script_progress : null;
  return progress?.path === 'profile_context' && ['location', 'work', 'birthday', 'timezone'].includes(progress.stage)
    ? progress.stage
    : '';
}

async function storeInbound({ base, key, application, sender, received, emailId, occurredAt, profileStage }) {
  const content = clean(received.text, 30000) || htmlToText(received.html) || '[email contained no text body]';
  const messageId = clean(received.message_id || header(received.headers, 'message-id'), 1000);
  const subject = clean(received.subject, 500);
  const profileAnswer = profileAnswerFromReply(profileStage, content);
  const response = await fetch(`${base}/rest/v1/messages`, {
    method: 'POST',
    headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      application_id: application.id,
      sender_type: 'customer',
      sender_name: sender.name || sender.email,
      content,
      message_type: 'text',
      metadata: {
        source: 'resend_inbound',
        channel: 'email',
        resend_email_id: emailId,
        message_id: messageId || null,
        subject: subject || null,
        in_reply_to: header(received.headers, 'in-reply-to') || null,
        references: header(received.headers, 'references') || null,
        sender_email: sender.email,
        recipient: received.to || null,
        profile_context_answer: profileAnswer ? { field: profileAnswer.field_name, value: profileAnswer.field_value, source: 'direct_customer_email_reply' } : null
      },
      read_at: null,
      created_at: occurredAt
    })
  });
  if (!response.ok) throw new Error(`Inbound message insert rejected: ${response.status}`);
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : rows;
}

async function recordInboundAudit({ base, key, applicationId, stored, emailId, occurredAt }) {
  const response = await fetch(`${base}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({
      event_key: `resend-inbound:${emailId}`,
      actor_type: 'customer',
      event_type: 'customer_email_received',
      entity_type: 'message',
      entity_id: stored.id,
      application_id: applicationId,
      source_table: 'messages',
      source_record_id: stored.id,
      channel: 'email',
      summary: 'Customer email received and stored',
      metadata: { resend_email_id: emailId, verified_webhook: true },
      occurred_at: occurredAt
    })
  });
  if (!response.ok) throw new Error(`Inbound audit rejected: ${response.status}`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  let raw;
  try {
    raw = await rawBody(req);
  } catch (error) {
    return res.status(error?.message === 'payload_too_large' ? 413 : 400).json({ ok: false, error: 'Webhook body unavailable.' });
  }
  const verified = verifyResendWebhook({
    raw,
    id: req.headers?.['svix-id'],
    timestamp: req.headers?.['svix-timestamp'],
    signature: req.headers?.['svix-signature'],
    secret: process.env.RESEND_WEBHOOK_SECRET
  });
  if (!verified) return res.status(401).json({ ok: false, error: 'Webhook signature invalid.' });

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ ok: false, error: 'Webhook payload invalid.' });
  }
  if (event?.type !== 'email.received') return res.status(200).json({ ok: true, ignored: true });

  const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  const resendKey = clean(process.env.RESEND_API_KEY, 10000);
  const emailId = clean(event?.data?.email_id, 300);
  if (!base || !key || !resendKey || !emailId) return res.status(503).json({ ok: false, error: 'Inbound email source unavailable.' });

  try {
    const received = await receivingEmail(resendKey, emailId);
    const sender = address(received.from || event?.data?.from);
    if (!EMAIL.test(sender.email)) return res.status(200).json({ ok: true, ignored: true, reason: 'sender_unavailable' });
    const application = await applicationForSender(base, key, sender.email);
    if (!application) return res.status(200).json({ ok: true, ignored: true, reason: 'application_not_found' });
    const duplicate = await existingMessage(base, key, application.id, emailId);
    if (duplicate) return res.status(200).json({ ok: true, duplicate: true, message_id: duplicate.id });

    const occurredAt = clean(event?.created_at || event?.data?.created_at, 100) || new Date().toISOString();
    const profileStage = await latestProfileContextStage(base, key, application.id);
    const stored = await storeInbound({ base, key, application, sender, received, emailId, occurredAt, profileStage });
    if (!stored?.id) throw new Error('Inbound message insert returned no source record');
    try {
      await recordInboundAudit({ base, key, applicationId: application.id, stored, emailId, occurredAt });
    } catch (error) {
      console.error('resend-inbound audit:', error?.message || error);
    }
    return res.status(200).json({ ok: true, stored: true, message_id: stored.id });
  } catch (error) {
    console.error('resend-inbound:', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Inbound email could not be stored.' });
  }
}

export const config = { api: { bodyParser: false } };

export { address as canonicalInboundAddress, header as canonicalInboundHeader, htmlToText as canonicalInboundHtmlToText };
