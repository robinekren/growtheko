import { createHash } from 'node:crypto';

import { sender } from './_mail-config.js';
import { draftHash, normalizeConversationScriptRequest, normalizeScriptProgress } from './lib/conversation-scripts.js';
import {
  attentionEmailSubject as attentionSubject,
  replyEmailSubject as replySubject,
  safeEmailHeader as safeHeader
} from './lib/email-subject.js';
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
  const firstName = (clean(name, 120).split(/\s+/)[0] || 'there').toLowerCase();
  const greeting = /^hey\b/i.test(clean(content, 80)) ? '' : `<p style="font-size:15px;line-height:1.7;margin:0 0 18px">hey ${escapeHtml(firstName)},</p>`;
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 22px;color:#101528">${greeting}<div style="font-size:15px;line-height:1.75;white-space:pre-wrap">${escapeHtml(content)}</div><p style="margin:28px 0 0;color:#6e788b;font-size:12px;line-height:1.6">Reply directly to this email to keep the conversation in one thread.</p></div>`;
}

function noraPunctuation(value) {
  return clean(value, MAX_MESSAGE_LENGTH)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/^(hey\s+[^,\n]{1,80})\s+-\s+/i, '$1, ');
}

function completedScriptProgress(value, content, now) {
  const progress = normalizeScriptProgress(value);
  if (!progress) return null;
  const sentContentHash = draftHash(content);
  return {
    ...progress,
    status: 'sent_after_operator_review',
    reviewed_by: 'robin',
    reviewed_at: now,
    sent_content_hash: sentContentHash,
    operator_edited: sentContentHash !== progress.draft_hash,
    auto_sent: false
  };
}

function localMessage(applicationId, content, scriptProgress, now) {
  return {
    id: `local-ops-reply-${Date.now()}`,
    application_id: applicationId,
    email: 'test-customer@growtheko.local',
    sender_type: 'team',
    sender_name: 'Nora',
    content,
    message_type: 'text',
    metadata: { source: 'ops_email_reply', channel: 'email', local_preview: true, delivery_email: 'not_sent', script_progress: scriptProgress },
    read_at: null,
    created_at: now
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

async function resolveLatestInboundThread(base, key, applicationId) {
  const response = await fetch(
    `${base}/rest/v1/messages?application_id=eq.${encodeURIComponent(applicationId)}&sender_type=eq.customer&select=metadata,created_at&order=created_at.desc&limit=1`,
    { headers: serviceHeaders(key) }
  );
  if (!response.ok) throw new Error(`Conversation thread lookup rejected: ${response.status}`);
  const metadata = (await response.json().catch(() => []))?.[0]?.metadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
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

function replyHeaders(thread = {}) {
  const messageId = safeHeader(thread.message_id, 500);
  if (!messageId) return undefined;
  const references = safeHeader(thread.references, 1500);
  return { 'In-Reply-To': messageId, References: [references, messageId].filter(Boolean).join(' ') };
}

async function sendEmailNotification({ email, name, content, messageId, subject, thread }) {
  const apiKey = clean(process.env.RESEND_API_KEY, 10000);
  const replyTo = clean(process.env.GROWTHEKO_INBOUND_EMAIL, 320).toLowerCase();
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
      subject,
      html: operatorEmailHtml({ name, content }),
      ...(EMAIL.test(replyTo) ? { reply_to: replyTo } : {}),
      headers: replyHeaders(thread)
    })
  });
  if (!response.ok) return { status: 'failed', id: null };
  const payload = await response.json().catch(() => ({}));
  return { status: 'sent', id: clean(payload.id, 240) || null };
}

async function recordAudit({ base, key, applicationId, messageId, emailStatus, scriptProgress, now }) {
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
      channel: 'email',
      summary: emailStatus === 'sent' ? 'Customer email reply sent and recorded' : 'Customer email reply recorded but not delivered',
      metadata: { sender_name: 'Nora', customer_channel: 'email', email_delivery: emailStatus, script_progress: scriptProgress, auto_sent: false },
      occurred_at: now
    })
  });
  if (!response.ok) throw new Error(`Audit rejected: ${response.status}`);
}

function scriptCompletion(body) {
  const request = normalizeConversationScriptRequest({ path: body.path, stage: body.stage, format: 'text' });
  if (!request || !body.completed || typeof body.completed !== 'object' || Array.isArray(body.completed)) return null;
  const completed = Object.entries(body.completed)
    .filter(([key, value]) => value === true && /^[a-z_]+:[a-z_]+$/.test(key))
    .slice(0, 40)
    .map(([key]) => key);
  const current = `${request.path}:${request.stage}`;
  if (!completed.includes(current)) return null;
  return { path: request.path, stage: request.stage, completed };
}

async function recordScriptCompletion({ base, key, applicationId, completion, now }) {
  const eventKey = `ops-script-progress:${createHash('sha256').update(`${applicationId}:${completion.path}:${completion.stage}`).digest('hex')}`;
  const response = await fetch(`${base}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({
      event_key: eventKey,
      actor_type: 'robin',
      actor_id: 'ops_user',
      event_type: 'conversation_script_stage_completed',
      entity_type: 'application',
      entity_id: applicationId,
      application_id: applicationId,
      source_table: 'applications',
      source_record_id: applicationId,
      channel: 'ops',
      summary: 'Conversation script stage completed',
      metadata: { ...completion, customer_message_sent: false, external_execution_performed: false },
      occurred_at: now
    })
  });
  if (!response.ok) throw new Error(`Script progress audit rejected: ${response.status}`);
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
  if (!['send', 'mark-read', 'script-progress'].includes(action) || (!UUID.test(applicationId) && !(isLocal && applicationId === 'local-test-customer'))) {
    return res.status(400).json({ ok: false, error: 'Conversation source is invalid.' });
  }

  const content = noraPunctuation(body.content);
  if (action === 'send' && (!content || content.length > MAX_MESSAGE_LENGTH)) {
    return res.status(400).json({ ok: false, error: 'Write a message before sending.' });
  }
  const completion = action === 'script-progress' ? scriptCompletion(body) : null;
  if (action === 'script-progress' && !completion) {
    return res.status(400).json({ ok: false, error: 'Script progress is invalid.' });
  }

  const scriptProgressProvided = body.script_progress !== undefined && body.script_progress !== null;
  const now = new Date().toISOString();
  const scriptProgress = action === 'send' ? completedScriptProgress(body.script_progress, content, now) : null;
  if (action === 'send' && scriptProgressProvided && !scriptProgress) {
    return res.status(400).json({ ok: false, error: 'Script progress is invalid.' });
  }

  if (isLocal) {
    if (action === 'mark-read') return res.status(200).json({ ok: true, local_preview: true });
    if (action === 'script-progress') return res.status(200).json({ ok: true, local_preview: true, completion, customer_message_sent: false });
    return res.status(201).json({
      ok: true,
      message: localMessage(applicationId, content, scriptProgress, now),
      delivery: { channel: 'email', email: 'preview_not_sent' },
      audit: 'preview',
      auto_sent: false
    });
  }

  const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!base || !key) return res.status(503).json({ ok: false, error: 'Inbox delivery is unavailable.' });

  try {
    if (action === 'script-progress') {
      const application = await resolveApplication(base, key, applicationId);
      if (!application) return res.status(404).json({ ok: false, error: 'Customer conversation was not found.' });
      await recordScriptCompletion({ base, key, applicationId, completion, now });
      return res.status(200).json({ ok: true, completion, customer_message_sent: false, external_execution_performed: false });
    }
    const [application, inboundThread] = await Promise.all([
      resolveApplication(base, key, applicationId),
      resolveLatestInboundThread(base, key, applicationId)
    ]);
    if (!application) return res.status(404).json({ ok: false, error: 'Customer conversation was not found.' });

    if (action === 'mark-read') {
      await markCustomerMessagesRead(base, key, applicationId, now);
      return res.status(200).json({ ok: true, read_at: now });
    }

    const email = clean(application.email, 320).toLowerCase();
    const customerName = clean(application.preferred_name || `${application.first_name || ''} ${application.last_name || ''}`.trim() || 'Customer', 160);
    const subject = attentionSubject({ name: customerName, content, threadSubject: inboundThread.subject });
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
          source: 'ops_email_reply',
          channel: 'email',
          notification_type: 'support_reply',
          delivery_email: 'pending',
          reply_to_message_id: safeHeader(inboundThread.message_id, 500) || null,
          subject,
          script_progress: scriptProgress,
          auto_sent: false
        }
      })
    });
    if (!insertResponse.ok) throw new Error(`Message insert rejected: ${insertResponse.status}`);
    const inserted = await insertResponse.json().catch(() => []);
    const stored = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!stored?.id) throw new Error('Message insert returned no source record');

    const emailDelivery = await sendEmailNotification({ email, name: customerName, content, messageId: stored.id, subject, thread: inboundThread });
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
    if (emailDelivery.status === 'sent') await markCustomerMessagesRead(base, key, applicationId, now);

    let audit = 'recorded';
    try {
      await recordAudit({ base, key, applicationId, messageId: stored.id, emailStatus: emailDelivery.status, scriptProgress, now });
    } catch (error) {
      audit = 'unavailable';
      console.error('ops-message audit:', error?.message || error);
    }

    return res.status(201).json({
      ok: true,
      message: { ...stored, email, metadata },
      delivery: { channel: 'email', email: emailDelivery.status },
      audit,
      auto_sent: false
    });
  } catch (error) {
    console.error('ops-message:', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Message could not be delivered.' });
  }
}

export {
  completedScriptProgress as canonicalCompletedScriptProgress,
  attentionSubject as canonicalAttentionSubject,
  noraPunctuation as canonicalNoraPunctuation,
  escapeHtml as canonicalOpsMessageEscapeHtml,
  operatorEmailHtml as canonicalOperatorEmailHtml,
  replyHeaders as canonicalReplyHeaders,
  replySubject as canonicalReplySubject
};
