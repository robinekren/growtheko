import { createHash } from 'node:crypto';
import { GROWTHEKO_NOTIFY_EMAIL, sender } from './_mail-config.js';

const ALLOWED_ORIGINS = new Set([
  'https://growtheko.com',
  'https://www.growtheko.com',
  'http://localhost:3000',
  'http://localhost:4310',
  'http://127.0.0.1:4310'
]);

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 8;
const MAX_PER_EMAIL = 4;
const buckets = globalThis.__growthekoWebinarBuckets || new Map();
globalThis.__growthekoWebinarBuckets = buckets;

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
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

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function rateLimited(req, email) {
  const now = Date.now();
  const ip = clean(req.headers?.['x-forwarded-for'], 300).split(',')[0].trim()
    || clean(req.headers?.['x-real-ip'], 100)
    || 'unknown';

  for (const [key, limit] of [[`ip:${ip}`, MAX_PER_IP], [`email:${email}`, MAX_PER_EMAIL]]) {
    const recent = (buckets.get(key) || []).filter(timestamp => now - timestamp < WINDOW_MS);
    if (recent.length >= limit) return true;
    recent.push(now);
    buckets.set(key, recent);
  }

  if (buckets.size > 2000) {
    for (const [key, timestamps] of buckets) {
      if (!timestamps.some(timestamp => now - timestamp < WINDOW_MS)) buckets.delete(key);
    }
  }
  return false;
}

function applyCors(req, res) {
  const origin = clean(req.headers?.origin, 300);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

function env() {
  return {
    supabaseUrl: clean(process.env.GROWTHEKO_SUPABASE_URL || process.env.SUPABASE_URL || '', 500).replace(/\/$/, ''),
    supabaseKey: clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '', 10000),
    resendKey: clean(process.env.RESEND_API_KEY || '', 10000),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function normalizeSessionDate(value) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const fallback = new Date();
  const friday = 5;
  const daysUntilFriday = (friday - fallback.getDay() + 7) % 7;
  fallback.setDate(fallback.getDate() + daysUntilFriday);
  fallback.setHours(18, 0, 0, 0);
  if (fallback <= new Date()) fallback.setDate(fallback.getDate() + 7);
  return fallback;
}

function sessionLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Europe/Vienna',
    timeZoneName: 'short'
  }).format(date);
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildIcs(sessionDate) {
  const end = new Date(sessionDate.getTime() + 90 * 60 * 1000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GrowthEko//AI Growth Training//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${createHash('sha256').update(sessionDate.toISOString()).digest('hex').slice(0, 24)}@growtheko.com`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(sessionDate)}`,
    `DTEND:${icsDate(end)}`,
    'SUMMARY:GrowthEko AI Growth Training',
    'DESCRIPTION:Free live 90-minute training. Watch your inbox for the private access details.',
    'LOCATION:Online',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function buildCalendarLinks(sessionDate) {
  const end = new Date(sessionDate.getTime() + 90 * 60 * 1000);
  const title = 'GrowthEko AI Growth Training';
  const details = 'Free live 90-minute training. The private access details will be sent before the live session.';
  const location = 'Online';
  const dates = `${icsDate(sessionDate)}/${icsDate(end)}`;
  const calendarFile = `https://www.growtheko.com/api/webinar-calendar?date=${encodeURIComponent(sessionDate.toISOString())}`;
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates,
    details,
    location,
    ctz: 'Europe/Vienna'
  });
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: sessionDate.toISOString(),
    enddt: end.toISOString(),
    body: details,
    location
  });
  return {
    google: `https://calendar.google.com/calendar/render?${query.toString()}`,
    apple: calendarFile,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlook.toString()}`
  };
}

async function supabaseRequest(path, options = {}) {
  const { supabaseUrl, supabaseKey } = env();
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(supabaseUrl) || !supabaseKey) {
    return { ok: false, status: 503, data: null };
  }
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}

async function storeRegistration(registration) {
  const response = await supabaseRequest('/rest/v1/contact_submissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      reason: 'webinar-registration',
      name: registration.name,
      email: registration.email,
      urgency: registration.session_date,
      message: JSON.stringify({
        phone: registration.phone,
        country_code: registration.country_code,
        dial_code: registration.dial_code,
        session_date: registration.session_date,
        source_url: registration.source_url,
        referrer: registration.referrer,
        ip: registration.ip,
        user_agent: registration.user_agent
      })
    })
  });
  return response.ok && Array.isArray(response.data) ? response.data[0] : null;
}

async function countForSession(sessionIso) {
  const response = await supabaseRequest(
    `/rest/v1/contact_submissions?reason=eq.webinar-registration&urgency=eq.${encodeURIComponent(sessionIso)}&select=id`,
    { headers: { Prefer: 'count=exact' } }
  );
  if (!response.ok) return null;
  const countHeader = response.headers?.get('content-range') || '';
  const match = countHeader.match(/\/(\d+)$/);
  if (match) return Number(match[1]);
  return Array.isArray(response.data) ? response.data.length : null;
}

async function sendEmail({ to, subject, html, attachments, idempotencyKey }) {
  const { resendKey } = env();
  if (!resendKey) throw new Error('RESEND_API_KEY is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: sender('GrowthEko'),
      to,
      subject,
      html,
      attachments
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    throw new Error(`Email delivery failed (${response.status})`);
  }
  return result.id;
}

async function sendAttendeeEmail(registration, sessionDate) {
  const label = sessionLabel(sessionDate);
  const links = buildCalendarLinks(sessionDate);
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#101217;line-height:1.55;">
      <p>Hey ${escapeHtml(registration.name.split(' ')[0] || registration.name)},</p>
      <p>your free seat for the <strong>GrowthEko AI Growth Training</strong> is reserved.</p>
      <p style="margin:18px 0;padding:16px 18px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;"><strong>Training:</strong> ${escapeHtml(label)}<br><strong>Format:</strong> Live online · 90 minutes</p>
      <p style="margin:22px 0 10px;">Add the training to your real calendar now:</p>
      <p style="margin:0 0 16px;">
        <a href="${escapeHtml(links.google)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:800;padding:14px 18px;border-radius:12px;">Add to Google Calendar</a>
      </p>
      <p style="font-size:14px;color:#4b5563;margin:0 0 18px;">
        iPhone / Apple Calendar: <a href="${escapeHtml(links.apple)}" style="color:#2563eb;font-weight:700;">open calendar file</a><br>
        Outlook: <a href="${escapeHtml(links.outlook)}" style="color:#2563eb;font-weight:700;">add to Outlook Calendar</a>
      </p>
      <p>The private access details will be sent before the live session.</p>
      <p>Show up focused. You only need one clean next move.</p>
      <p style="margin-top:30px;">Robin<br><span style="color:#6b7280;font-size:13px;">GrowthEko</span></p>
    </div>
  `;
  return sendEmail({
    to: registration.email,
    subject: 'Your GrowthEko AI Growth Training seat is reserved',
    html,
    idempotencyKey: `webinar-attendee-${createHash('sha256').update(registration.email + registration.session_date).digest('hex')}`
  });
}

async function sendAdminEmail(registration, sessionDate, sessionCount) {
  const countLabel = Number.isFinite(sessionCount) ? String(sessionCount) : 'New';
  const plural = sessionCount === 1 ? 'viewer' : 'viewers';
  const subject = sessionCount
    ? `${countLabel} ${plural} now for the webinar`
    : 'New webinar viewer locked in';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#101217;line-height:1.55;">
      <div style="padding:18px 20px;border-radius:16px;background:#06150d;color:#fff;margin-bottom:18px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#87efac;font-weight:800;">GrowthEko dopamine hit</div>
        <div style="font-size:34px;font-weight:900;letter-spacing:-.04em;margin-top:4px;">${escapeHtml(countLabel)} ${escapeHtml(plural)}</div>
        <div style="color:rgba(255,255,255,.72);font-size:14px;">Someone just reserved a free webinar seat.</div>
      </div>
      <p><strong>Name:</strong> ${escapeHtml(registration.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(registration.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(registration.phone || 'Not provided')}</p>
      <p><strong>Session:</strong> ${escapeHtml(sessionLabel(sessionDate))}</p>
      <p><strong>Source:</strong> ${escapeHtml(registration.source_url || 'Unknown')}</p>
      <p style="margin-top:24px;font-weight:800;">Momentum is real. One more person entered the room.</p>
    </div>
  `;
  return sendEmail({
    to: GROWTHEKO_NOTIFY_EMAIL,
    subject,
    html,
    idempotencyKey: `webinar-admin-${createHash('sha256').update(registration.email + registration.created_at).digest('hex')}`
  });
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json is required' });
  }

  const body = parseBody(req.body);
  if (body.website || body.url || body._honey) return res.status(200).json({ ok: true });

  const name = clean(body.name || body.fullName || body.firstName, 160);
  const email = clean(body.email, 254).toLowerCase();
  const dialCode = clean(body.dialCode || body.dial_code, 20);
  const phoneRaw = clean(body.phone, 60);
  const sessionDate = normalizeSessionDate(body.sessionDate);
  const sessionIso = sessionDate.toISOString();

  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  if (rateLimited(req, email)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  const registration = {
    created_at: new Date().toISOString(),
    name,
    email,
    phone: phoneRaw ? `${dialCode} ${phoneRaw}`.trim() : null,
    country_code: clean(body.countryCode || body.country_code, 8) || null,
    dial_code: dialCode || null,
    session_date: sessionIso,
    source_url: clean(body.sourceUrl || body.source_url, 500) || null,
    referrer: clean(body.referrer, 500) || null,
    user_agent: clean(req.headers?.['user-agent'], 500) || null,
    ip: clean(req.headers?.['x-forwarded-for'], 300).split(',')[0].trim()
      || clean(req.headers?.['x-real-ip'], 100)
      || null,
  };

  try {
    const stored = await storeRegistration(registration).catch(error => {
      console.error('Webinar registration storage failed.', { name: error?.name || 'Error' });
      return null;
    });
    const sessionCount = await countForSession(sessionIso).catch(() => null);
    await sendAttendeeEmail(registration, sessionDate);
    await sendAdminEmail(registration, sessionDate, sessionCount || (stored ? 1 : null));
    return res.status(200).json({
      ok: true,
      stored: Boolean(stored),
      sessionCount: sessionCount || null
    });
  } catch (error) {
    console.error('Webinar registration failed.', { name: error?.name || 'Error' });
    return res.status(502).json({ error: 'Registration email is temporarily unavailable.' });
  }
}
