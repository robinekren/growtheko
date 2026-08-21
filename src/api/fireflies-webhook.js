import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 1024 * 1024;
const FIREFLIES_GRAPHQL = 'https://api.fireflies.ai/graphql';
const ALLOWED_EVENTS = new Set(['meeting.transcribed', 'meeting.summarized']);

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{6,160}$/.test(id) ? id : '';
}

function safeApplicationId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{8,128}$/.test(id) ? id : '';
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 320);
}

function serviceHeaders(serviceKey, extra = {}) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra };
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function validSignature(raw, signature, secret) {
  if (!signature || !secret || secret.length < 24) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const suppliedBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

async function fetchTranscript(apiKey, meetingId) {
  const query = `query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id title date organizer_email participants transcript_url duration
      summary { overview action_items short_summary topics_discussed }
      sentences { index speaker_name text start_time end_time }
    }
  }`;
  const response = await fetch(FIREFLIES_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables: { transcriptId: meetingId } })
  });
  if (!response.ok) throw new Error(`fireflies_${response.status}`);
  const payload = await response.json();
  if (payload?.errors?.length || !payload?.data?.transcript) throw new Error('fireflies_transcript_unavailable');
  return payload.data.transcript;
}

function transcriptText(transcript) {
  return (Array.isArray(transcript.sentences) ? transcript.sentences : [])
    .map(sentence => {
      const speaker = String(sentence?.speaker_name || 'Speaker').trim();
      const text = String(sentence?.text || '').trim();
      return text ? `${speaker}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function fetchMatchingApplications(base, serviceKey, emails) {
  if (!emails.length) return [];
  const response = await fetch(
    `${base}/rest/v1/applications?select=id,email,preferred_name,first_name,last_name&order=submitted_at.desc&limit=2000`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!response.ok) throw new Error(`applications_${response.status}`);
  const rows = await response.json();
  const wanted = new Set(emails);
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const id = safeApplicationId(row.id);
    const email = normalizedEmail(row.email);
    if (!id || !wanted.has(email) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function existingApplicationIds(base, serviceKey, applications, meetingId, event) {
  if (!applications.length) return new Set();
  const ids = applications.map(application => safeApplicationId(application.id)).filter(Boolean);
  const response = await fetch(
    `${base}/rest/v1/messages?application_id=in.(${ids.map(encodeURIComponent).join(',')})&message_type=eq.meeting_transcript&select=application_id,metadata&order=created_at.desc&limit=2000`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!response.ok) throw new Error(`messages_${response.status}`);
  const rows = await response.json();
  return new Set((Array.isArray(rows) ? rows : []).filter(row => {
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return metadata.fireflies_meeting_id === meetingId && metadata.fireflies_event === event;
  }).map(row => String(row.application_id)));
}

async function storeTranscript(base, serviceKey, applications, transcript, event) {
  const meetingId = safeId(transcript.id);
  const existing = await existingApplicationIds(base, serviceKey, applications, meetingId, event);
  const content = transcriptText(transcript);
  if (!content) throw new Error('empty_transcript');
  const rows = applications.filter(application => !existing.has(String(application.id))).map(application => ({
    application_id: application.id,
    sender_type: 'system',
    sender_name: 'Fireflies',
    content,
    message_type: 'meeting_transcript',
    metadata: {
      source: 'fireflies_v2',
      fireflies_event: event,
      fireflies_meeting_id: meetingId,
      title: String(transcript.title || '').slice(0, 500),
      organizer_email: normalizedEmail(transcript.organizer_email),
      participants: (Array.isArray(transcript.participants) ? transcript.participants : []).map(normalizedEmail).filter(Boolean),
      transcript_url: String(transcript.transcript_url || '').slice(0, 2000),
      duration_minutes: Number(transcript.duration) || null,
      meeting_date: Number.isFinite(Number(transcript.date)) ? new Date(Number(transcript.date)).toISOString() : null,
      summary: transcript.summary || null,
      recording_notice: 'announced_before_recording',
      retention_class: 'customer_call_transcript_12_months'
    }
  }));
  if (!rows.length) return 0;
  const response = await fetch(`${base}/rest/v1/messages`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`insert_${response.status}`);
  return rows.length;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const signingSecret = String(process.env.FIREFLIES_WEBHOOK_SECRET || '');
  const apiKey = String(process.env.FIREFLIES_API_KEY || '');
  const base = String(process.env.GROWTHEKO_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY || '');
  if (!signingSecret || !apiKey || !base || !serviceKey) return res.status(503).json({ error: 'Integration not configured.' });

  try {
    const raw = await readRawBody(req);
    if (!validSignature(raw, header(req, 'x-hub-signature'), signingSecret)) return res.status(401).json({ error: 'Invalid signature.' });
    const payload = JSON.parse(raw.toString('utf8'));
    const event = String(payload?.event || '');
    const meetingId = safeId(payload?.meeting_id);
    if (!ALLOWED_EVENTS.has(event) || !meetingId) return res.status(202).json({ status: 'ignored' });

    const transcript = await fetchTranscript(apiKey, meetingId);
    const participantEmails = [...new Set([
      ...(Array.isArray(transcript.participants) ? transcript.participants : []),
      transcript.organizer_email
    ].map(normalizedEmail).filter(Boolean))];
    const applications = await fetchMatchingApplications(base, serviceKey, participantEmails);
    if (!applications.length) return res.status(202).json({ status: 'unmatched' });
    const stored = await storeTranscript(base, serviceKey, applications, transcript, event);
    return res.status(200).json({ status: 'stored', customer_records: stored });
  } catch (error) {
    console.error('fireflies-webhook:', error?.message || error);
    if (error?.message === 'payload_too_large') return res.status(413).json({ error: 'Payload too large.' });
    return res.status(503).json({ error: 'Transcript processing unavailable.' });
  }
}
