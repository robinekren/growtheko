// =====================================================================
// /api/playbook-signup — Lead-Magnet email-capture endpoint
// Stack: Vercel Serverless Function · Node 18 runtime
// Storage: Supabase `playbook_signups` table (see schema below)
// Datum: 2026-05-16
// =====================================================================
//
// REQUIRED ENV VARS (Vercel Project Settings):
//   SUPABASE_URL                — e.g. https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service_role key (server-only, never client)
//   RESEND_API_KEY              — optional, for welcome email (Resend.com)
//   RESEND_FROM                 — optional, e.g. "Robin <robin@growtheko.com>"
//
// SUPABASE SCHEMA (run once in SQL editor):
//
//   CREATE TABLE IF NOT EXISTS playbook_signups (
//     id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     created_at   timestamptz DEFAULT now() NOT NULL,
//     first_name   text NOT NULL,
//     email        text NOT NULL,
//     utm_source   text,
//     utm_medium   text,
//     utm_campaign text,
//     utm_content  text,
//     utm_term     text,
//     referrer     text,
//     ip           text,
//     user_agent   text,
//     UNIQUE(email)
//   );
//   CREATE INDEX IF NOT EXISTS playbook_signups_created_idx ON playbook_signups(created_at DESC);
//   ALTER TABLE playbook_signups ENABLE ROW LEVEL SECURITY;
//   -- service_role bypasses RLS, no policy needed for backend writes
//
// =====================================================================

import { createHash } from 'node:crypto';

const ALLOWED_ORIGINS = new Set([
  'https://growtheko.com',
  'https://www.growtheko.com',
  'http://localhost:3000',
  'http://localhost:4310',
  'http://127.0.0.1:4310'
]);
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 3;
const rateBuckets = globalThis.__growthekoPlaybookRateBuckets || new Map();
globalThis.__growthekoPlaybookRateBuckets = rateBuckets;

function isValidEmail(e) {
  return typeof e === 'string'
    && e.length > 4 && e.length < 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function sanitize(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function rateLimited(req, email) {
  const now = Date.now();
  const forwarded = sanitize(req.headers['x-forwarded-for'] || '', 300).split(',')[0].trim();
  const ip = forwarded || sanitize(req.headers['x-real-ip'] || '', 100) || 'unknown';
  for (const [key, limit] of [[`ip:${ip}`, MAX_PER_IP], [`email:${email}`, MAX_PER_EMAIL]]) {
    const recent = (rateBuckets.get(key) || []).filter(timestamp => now - timestamp < RATE_WINDOW_MS);
    if (recent.length >= limit) return true;
    recent.push(now);
    rateBuckets.set(key, recent);
  }
  if (rateBuckets.size > 2000) {
    for (const [key, timestamps] of rateBuckets) {
      if (!timestamps.some(timestamp => now - timestamp < RATE_WINDOW_MS)) rateBuckets.delete(key);
    }
  }
  return false;
}

export default async function handler(req, res) {
  const origin = sanitize(req.headers.origin || '', 300);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json is required' });
  }

  // Parse body (Vercel auto-parses JSON when Content-Type is application/json)
  const body = typeof req.body === 'string' ? safeJsonParse(req.body) : (req.body || {});

  const firstName = sanitize(body.firstName, 100);
  const email     = sanitize(body.email, 254).toLowerCase();

  if (!firstName) {
    return res.status(400).json({ error: 'First name required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (rateLimited(req, email)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  // Honeypot — if any of these are set, drop silently (bot)
  if (body.website || body.url || body._honey) {
    return res.status(200).json({ ok: true });
  }

  const SUPABASE_URL = sanitize(
    process.env.GROWTHEKO_SUPABASE_URL || process.env.SUPABASE_URL || '',
    500
  ).replace(/\/$/, '');
  const SUPABASE_KEY = sanitize(
    process.env.GROWTHEKO_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    10000
  );
  const RESEND_API_KEY = sanitize(process.env.RESEND_API_KEY || '', 10000);
  const RESEND_FROM = sanitize(process.env.RESEND_FROM || '', 500);

  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(SUPABASE_URL) || !SUPABASE_KEY || !RESEND_API_KEY || !RESEND_FROM) {
    return res.status(503).json({ error: 'Playbook delivery is unavailable.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.headers['x-real-ip']
    || '';
  const userAgent = sanitize(req.headers['user-agent'] || '', 500);

  const payload = {
    first_name:   firstName,
    email:        email,
    utm_source:   sanitize(body.utm_source, 100) || null,
    utm_medium:   sanitize(body.utm_medium, 100) || null,
    utm_campaign: sanitize(body.utm_campaign, 100) || null,
    utm_content:  sanitize(body.utm_content, 100) || null,
    utm_term:     sanitize(body.utm_term, 100) || null,
    referrer:     sanitize(body.referrer, 500) || null,
    ip:           sanitize(ip, 100) || null,
    user_agent:   userAgent || null,
  };

  // Persistent email dedupe: an existing unique signup never triggers another
  // delivery. A new delivery is awaited and provider-idempotent before storage.
  try {
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/playbook_signups?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await existingRes.json().catch(() => null);
    if (!existingRes.ok || !Array.isArray(existing)) {
      console.error('Playbook dedupe lookup failed.', { status: existingRes.status });
      return res.status(502).json({ error: 'Playbook delivery is temporarily unavailable.' });
    }
    if (existing.length > 0) {
      return res.status(200).json({ ok: true, stored: true, emailSent: false });
    }

    await sendWelcomeEmail(email, firstName, RESEND_API_KEY, RESEND_FROM);

    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/playbook_signups?on_conflict=email`, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'apikey':         SUPABASE_KEY,
        'Authorization':  `Bearer ${SUPABASE_KEY}`,
        'Prefer':         'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    });
    const saved = await supaRes.json().catch(() => null);
    if (!supaRes.ok || !Array.isArray(saved)) {
      console.error('Playbook signup storage failed.', { status: supaRes.status });
      return res.status(502).json({ error: 'Playbook delivery is temporarily unavailable.' });
    }
    return res.status(200).json({ ok: true, stored: true, emailSent: true });
  } catch (err) {
    console.error('Playbook signup failed.', { name: err?.name || 'Error' });
    return res.status(502).json({ error: 'Playbook delivery is temporarily unavailable.' });
  }
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

async function sendWelcomeEmail(email, firstName, apiKey, from) {
  const downloadUrl = 'https://growtheko.com/playbook/ai-growth-playbook.pdf';
  const subject = `${firstName}, the AI Growth Playbook is yours`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.55;">
      <p>${escapeHtml(firstName)},</p>
      <p>Thanks for grabbing the Playbook. Here's your copy:</p>
      <p style="margin:24px 0;">
        <a href="${downloadUrl}" style="background:#0a0a0a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:500;">Download the Playbook (PDF)</a>
      </p>
      <p>It is a 13-page guide. Read it once and write down the single operating move you will test first. If the framework fits, compare the ongoing GrowthEko Operator Membership and the focused GrowthEko AI Operator Audit at <a href="https://growtheko.com/start#offers" style="color:#0a0a0a;">growtheko.com/start</a>.</p>
      <p>Or just reply to this email — I read everything.</p>
      <p style="margin-top:32px;">— Robin Ekren<br/><span style="color:#6a6a6a;font-size:13px;">growtheko.com · @robinekren</span></p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'Idempotency-Key': `growtheko-playbook-${createHash('sha256').update(email).digest('hex').slice(0, 32)}`,
    },
    body: JSON.stringify({
      from,
      to:   email,
      subject,
      html,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    throw new Error(`Playbook email delivery failed (${response.status})`);
  }
  return result.id;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
