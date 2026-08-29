import { createHash } from 'node:crypto';

import { hasOpsSession, isLocalDevelopmentRequest, isSameOrigin } from './lib/ops-session.js';
import {
  canonicalConversationSource,
  conversationScriptOptions,
  conversationScriptPrompt,
  deterministicConversationDraft,
  draftHash,
  normalizeConversationDraft,
  normalizeConversationScriptRequest,
  recommendConversationMove
} from './lib/conversation-scripts.js';
import { attentionEmailSubject } from './lib/email-subject.js';
import { loadVerifiedCustomerLevel } from './lib/customer-level-source.js';
import { canonicalOperatorEmailAction } from './lib/operator-email-action.js';
import { customerProfileFromAnswers, customerProfileFromMessageMetadata, mergeCustomerProfiles } from './lib/customer-profile.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function serviceHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function canonicalSource(base, key, applicationId) {
  const [applicationResponse, messagesResponse] = await Promise.all([
    fetch(`${base}/rest/v1/applications?id=eq.${encodeURIComponent(applicationId)}&select=id,email,first_name,last_name,preferred_name,website,product_type,stage,status,selected_tier,goal,dream_outcome,biggest_challenge,holding_back,call_status,call_date&limit=1`, { headers: serviceHeaders(key) }),
    fetch(`${base}/rest/v1/messages?application_id=eq.${encodeURIComponent(applicationId)}&message_type=eq.text&select=sender_type,content,created_at,metadata&order=created_at.asc&limit=50`, { headers: serviceHeaders(key) })
  ]);
  if (!applicationResponse.ok || !messagesResponse.ok) throw new Error('Conversation source unavailable');
  const application = (await applicationResponse.json().catch(() => []))?.[0];
  if (!application) return null;
  const messages = await messagesResponse.json().catch(() => []);
  let profileContext = customerProfileFromAnswers([]);
  let customer = null;
  try {
    const customerResponse = await fetch(`${base}/rest/v1/customers?email=eq.${encodeURIComponent(application.email || '')}&select=id,email,tier,amount_paid,paid_at&limit=1`, { headers: serviceHeaders(key) });
    customer = customerResponse.ok ? (await customerResponse.json().catch(() => []))?.[0] : null;
    if (customer?.id) {
      const sessionResponse = await fetch(`${base}/rest/v1/onboarding_sessions?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,status,completed_at&order=completed_at.desc.nullslast&limit=1`, { headers: serviceHeaders(key) });
      const session = sessionResponse.ok ? (await sessionResponse.json().catch(() => []))?.[0] : null;
      if (session?.id) {
        const answersResponse = await fetch(`${base}/rest/v1/onboarding_answers?session_id=eq.${encodeURIComponent(session.id)}&select=field_name,field_value`, { headers: serviceHeaders(key) });
        if (answersResponse.ok) profileContext = customerProfileFromAnswers(await answersResponse.json().catch(() => []));
      }
    }
  } catch {
    profileContext = customerProfileFromAnswers([]);
  }
  application.customer_level = await loadVerifiedCustomerLevel({ base, key, application, customer });
  application.profile_context = mergeCustomerProfiles(profileContext, customerProfileFromMessageMetadata(messages));
  const source = canonicalConversationSource(application, messages);
  const latestInbound = [...messages].reverse().find(message => message?.sender_type === 'customer');
  source.thread_subject = clean(latestInbound?.metadata?.subject, 300);
  return source;
}

function localSource(applicationId) {
  return canonicalConversationSource({
    id: applicationId,
    preferred_name: 'Mia',
    product_type: 'AI consulting',
    stage: 'applied',
    goal: 'Build a clear first offer and a reliable path to the right customer.',
    biggest_challenge: 'The offer and next step still feel too broad.',
    profile_context: { birth_date: '2001-04-17', city: 'Vienna', current_job: 'AI consultant', timezone: 'Europe/Vienna', source: 'customer_provided' }
  }, [
    { sender_type: 'team', content: 'thanks for sharing the context. what feels most urgent right now?', created_at: '2026-08-27T09:00:00.000Z' },
    { sender_type: 'customer', content: 'i want to start, but i am not sure which part to fix first.', created_at: '2026-08-27T09:05:00.000Z' }
  ]);
}

async function anthropicDraft(source, request) {
  const apiKey = clean(process.env.ANTHROPIC_API_KEY, 10000);
  if (!apiKey) return null;
  const prompt = conversationScriptPrompt(source, request);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: clean(process.env.GROWTHEKO_NORA_MODEL, 120) || 'claude-sonnet-4-20250514',
      max_tokens: request.format === 'voice_note' ? 650 : 350,
      temperature: 0.2,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Draft provider rejected: ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  return clean(payload.content?.find(item => item?.type === 'text')?.text, 5000) || null;
}

function draftIdentity(applicationId, request, source, draft) {
  const latest = source.messages.at(-1)?.created_at || '';
  return `script-${createHash('sha256').update(JSON.stringify([applicationId, request.path, request.stage, request.format, latest, draft])).digest('hex').slice(0, 24)}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!hasOpsSession(req.headers?.cookie)) return res.status(401).json({ ok: false, error: 'Session expired.' });
  if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request unavailable.' });
  if (req.method === 'GET') return res.status(200).json({ ok: true, ...conversationScriptOptions(), draft_only: true, customer_channel: 'email' });

  const body = parseBody(req.body);
  const applicationId = clean(body.application_id, 140);
  const recommendationOnly = clean(body.action, 40).toLowerCase() === 'recommend';
  const request = normalizeConversationScriptRequest(body);
  const isLocal = isLocalDevelopmentRequest(req);
  if ((!recommendationOnly && !request) || (!UUID.test(applicationId) && !(isLocal && applicationId === 'local-test-customer'))) {
    return res.status(400).json({ ok: false, error: 'Script source is invalid.' });
  }

  let source;
  if (isLocal) {
    source = localSource(applicationId);
  } else {
    const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
    const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
    if (!base || !key) return res.status(503).json({ ok: false, error: 'Conversation source unavailable.' });
    try {
      source = await canonicalSource(base, key, applicationId);
    } catch (error) {
      console.error('ops-script source:', error?.message || error);
      return res.status(503).json({ ok: false, error: 'Conversation source unavailable.' });
    }
    if (!source) return res.status(404).json({ ok: false, error: 'Customer conversation was not found.' });
  }

  const recommendation = recommendConversationMove(source);
  if (recommendationOnly) {
    return res.status(200).json({
      ok: true,
      recommendation,
      customer_channel: 'email',
      auto_sent: false
    });
  }

  const fallback = deterministicConversationDraft(source, request);
  let draft = fallback;
  let generator = isLocal ? 'deterministic' : 'deterministic_fallback';
  if (!isLocal && process.env.ANTHROPIC_API_KEY) {
    try {
      const candidate = await anthropicDraft(source, request);
      const safeCandidate = normalizeConversationDraft(candidate, source);
      if (safeCandidate) {
        draft = safeCandidate;
        generator = 'anthropic';
      } else {
        generator = 'deterministic_safety_fallback';
      }
    } catch (error) {
      console.error('ops-script provider:', error?.message || error);
    }
  }

  const progress = {
    draft_id: draftIdentity(applicationId, request, source, draft),
    draft_hash: draftHash(draft),
    generator,
    path: request.path,
    stage: request.stage,
    format: request.format,
    status: 'draft_only'
  };
  const emailSubject = attentionEmailSubject({
    name: source.application.first_name,
    content: draft,
    threadSubject: source.thread_subject,
    path: request.path,
    stage: request.stage
  });
  const latestInboundContent = [...source.messages].reverse().find(message => message.sender === 'customer')?.content || '';
  const emailAction = canonicalOperatorEmailAction({
    path: request.path,
    stage: request.stage,
    commercialNextStep: source.commercial_next_step,
    latestInboundContent,
    replyTo: process.env.GROWTHEKO_INBOUND_EMAIL
  });
  return res.status(200).json({
    ok: true,
    draft,
    email_subject: emailSubject,
    email_action: emailAction,
    script_progress: progress,
    recommendation,
    source: isLocal ? 'local_deterministic_scenario' : 'canonical_application_messages',
    verified_message_count: source.messages.length,
    customer_channel: 'email',
    auto_sent: false
  });
}

export { canonicalSource as canonicalOpsScriptSource, localSource as canonicalLocalScriptSource };
