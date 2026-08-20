import { GROWTHEKO_PUBLIC_EMAIL, GROWTHEKO_RESEND_FROM } from './_mail-config.js';
import { createHash } from 'node:crypto';

// /api/apply.js — GrowthEko application endpoint
// Receives application data from /apply, stores it in Supabase,
// then sends a confirmation email before redirecting the applicant to the private community.

const AI_GROWTH_PLAYBOOK_BASE64 = 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDExCi9LaWRzIFsgNCAwIFIgMTAgMCBSIDE5IDAgUiAyMSAwIFIgMjMgMCBSIDI1IDAgUiAyNyAwIFIgMjkgMCBSIDMxIDAgUiAzMyAwIFIgMzUgMCBSIF0KPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1Byb2R1Y2VyIChweXBkZikKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9Db250ZW50cyA1IDAgUgovTWVkaWFCb3ggWyAwIDAgNjEyIDc5MiBdCi9SZXNvdXJjZXMgPDwKL0ZvbnQgNiAwIFIKL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4KL1JvdGF0ZSAwCi9UcmFucyA8PAo+PgovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9GaWx0ZXIgWyAvQVNDSUk4NURlY29kZSAvRmxhdGVEZWNvZGUgXQovTGVuZ3RoIDgwNgo+PgpzdHJlYW0KR2FzSWU+dTAzLydSZTwyXDUqYj9BR2c8LUVDRmA0YFczRTdWSjVCPyJMaUtLblddbj04R2hxaFouaS9TW1xZKUZcaiNrW2o1VmhkcGdOLXI9OThtZDMjYVNbKjNwRzk4TC5pNTBbLF5JXUY9RCNmWmNONVM3cysnLmc6U3VfNFtCRF8vK2JJPVw6TlJCby5YPTMjWVNxXkxlOyI6WTBQQSksPnJnZyU3Rjw1OVcsRi0vZnRnUVVEMXRbbi9RdG1xWmBPM0QkPVZBS3VCbGk4RExDKHRaSz0qYVpiUGIySjVSTDReK1liPiJCaGhnLDczKE9hQTwxLzd0WjhIaUA2OnQzOG45OHBPc1ZFOEtZZU9YbWNbMFI8OGdFJFo0TStCV3QqQG5fai9QTUxWaDgkNzBDQTRjUFEhO2lqcHAoN2YpQHFKblU6YnVGKm4pTVVkWl9POTdJIzdZPjgzdVNtXS5ealIkVEc/P2JuZ2soNCMuUGlnc0RfRzVXKD4qImZcL1U6NEMnYGxDP1ptMlwqXUtQQEdPUXE2QjpXLS9aamxjJFBpPkwhWmRnakR0IVkvVUtMXyk5ZzladUdEbjZPdC87bi51VFA5PDg9YEEmPyY8OWAzX0BLJklwXShOXVRJQ2pROl83STIoI2dVOEJjIlpURVRqVnFDLjshRlFVcy0mK005YWtTP20xY25yO2JDY3U0K1dNSTlBX2NtRGROUEFIME82NlQ9WWo5IyIuWTwnPWAnV2xnKVNNIj9XakY/TmBgUkprQmk8TVA5cStScFhiWWM+KShfSC9uJjVFMVdFWF4yaFlCVSFVYSUrc1JFNDg0P0ozSlFFLjZMa2RwKFI3TGFSWT10YlE2dWo9YixbTUg7J04pbTYzMDxwSDhPPzUtJjwvaVpnJHVBVU1zXy5dL1JmTF5QbVBvUkteKzo/a0tERjE1WF5SXjBoV0MyZ1oxImxaKWhmdTdJbFBhTllDIWNaXVFiL2c0LmVoSEVYI0BVcXJGQ2UqPjQpRFgzSWxfUD47NC1ANSxzLF5OUV9bcDgxQj4hR2c0KWozR19IcVU3fj4KZW5kc3RyZWFtCmVuZG9iag...';

const ALLOWED_ORIGINS = [
  'https://growtheko.com',
  'https://www.growtheko.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4310',
  'http://127.0.0.1:4310'
];

const ALLOWED_OFFER_KEYS = new Set([
  'roadmap_1997',
  'done_with_you_5000',
  'done_for_you_14997',
  'recommendation',
  'monthly_97',
  'onetime_1997'
]);
const REQUIRED_FIELDS = [
  'email', 'first_name', 'last_name', 'motivation', 'profile_type',
  'product_type', 'revenue_stage', 'primary_geo_market', 'company_size',
  'holding_back', 'urgency', 'investment_readiness', 'selected_tier'
];
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitBuckets = globalThis.__growthekoApplyRateLimitBuckets || new Map();
globalThis.__growthekoApplyRateLimitBuckets = rateLimitBuckets;
const inFlightEmails = globalThis.__growthekoApplyInFlightEmails || new Set();
globalThis.__growthekoApplyInFlightEmails = inFlightEmails;

function cleanString(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanArray(value, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => cleanString(item, 100)).filter(Boolean);
}

function normalizeApplication(raw = {}) {
  const data = {
    email: cleanString(raw.email, 254).toLowerCase(),
    first_name: cleanString(raw.first_name, 100),
    last_name: cleanString(raw.last_name, 100),
    website: cleanString(raw.website, 500),
    motivation: cleanString(raw.motivation, 200),
    motivation_other: cleanString(raw.motivation_other, 1500),
    profile_type: cleanString(raw.profile_type, 100),
    creator_name: cleanString(raw.creator_name, 200),
    content_niche: cleanString(raw.content_niche, 200),
    platforms: cleanArray(raw.platforms),
    product_type: cleanString(raw.product_type, 100),
    revenue_stage: cleanString(raw.revenue_stage, 100),
    primary_geo_market: cleanString(raw.primary_geo_market, 100),
    additional_markets: cleanArray(raw.additional_markets),
    company_size: cleanString(raw.company_size, 100),
    holding_back: cleanString(raw.holding_back, 300),
    goal: cleanString(raw.goal, 2000),
    urgency: cleanString(raw.urgency, 100),
    investment_readiness: cleanString(raw.investment_readiness, 100),
    selected_tier: cleanString(raw.selected_tier, 50).toLowerCase()
  };
  if (!/^\S+@\S+\.\S+$/.test(data.email)) throw new Error('invalid_application');
  if (REQUIRED_FIELDS.some((field) => !data[field])) throw new Error('invalid_application');
  if (!ALLOWED_OFFER_KEYS.has(data.selected_tier)) throw new Error('invalid_offer');
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function getRateLimitKey(req, email) {
  const forwarded = cleanString(req.headers?.['x-forwarded-for'], 300).split(',')[0].trim();
  const ip = forwarded || cleanString(req.headers?.['x-real-ip'], 100) || 'unknown';
  return `${ip}:${email}`;
}

function isRateLimited(req, email) {
  const now = Date.now();
  const key = getRateLimitKey(req, email);
  const attempts = (rateLimitBuckets.get(key) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (attempts.length >= RATE_LIMIT_MAX) return true;
  attempts.push(now);
  rateLimitBuckets.set(key, attempts);
  if (rateLimitBuckets.size > 1000) {
    for (const [bucketKey, timestamps] of rateLimitBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) rateLimitBuckets.delete(bucketKey);
    }
  }
  return false;
}

async function checkedFetch(url, options, label) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`${label} failed (${response.status}):`, detail.slice(0, 500));
    throw new Error(`${label}_failed`);
  }
  return response;
}

async function sendConfirmationEmail(data, isReturning) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM || process.env.GROWTHEKO_RESEND_FROM || GROWTHEKO_RESEND_FROM;
  if (!RESEND_API_KEY || !RESEND_FROM) throw new Error('email_not_configured');

  const firstName = escapeHtml(data.first_name);
  const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min?name=${encodeURIComponent(data.first_name + ' ' + data.last_name)}&email=${encodeURIComponent(data.email)}`;
  const communityUrl = 'https://www.skool.com/themepages';

  let html;
  let subject;

  if (isReturning) {
    subject = 'Welcome back: your next step is still open';
    html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#151725;line-height:1.6;">
  <div style="padding:40px 30px;">
    <p style="font-size:17px;">Hey ${firstName},</p>
    <p style="font-size:17px;">We noticed you submitted another application, and we have your latest info.</p>
    <p style="font-size:17px;">Before you book anything else, enter the private community while the context is still fresh.</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a>
    </p>
    <p style="font-size:15px;color:#555;">Your Free Clarity Call link is still here if you need it later: <a href="${calendlyUrl}" style="color:#2459c8;">book the call</a>.</p>
    <p style="font-size:17px;">Talk soon,<br/>Robin &amp; the GrowthEko team</p>
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;" />
    <p style="font-size:12px;color:#999;">GrowthEko | growtheko.com<br/>You're receiving this because you applied at growtheko.com/apply<br/>${GROWTHEKO_PUBLIC_EMAIL}</p>
  </div>
</div>`;
  } else {
    subject = "You're in: read this before your Free Clarity Call";
    html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#151725;line-height:1.6;">
  <div style="padding:40px 30px;">
    <p style="font-size:17px;">Hey ${firstName},</p>
    <p style="font-size:17px;">Your application just came through.</p>
    <p style="font-size:17px;">Do this while the idea is still warm: enter the private community first. That is where the next step, context, and direction will live.</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a>
    </p>
    <p style="font-size:17px;">After that, book your Free Clarity Call and come in with one honest bottleneck you want diagnosed.</p>
    <p style="font-size:17px;">On the call, we can:</p>
    <ul style="font-size:17px;padding-left:20px;">
      <li>Identify your real operator bottleneck</li>
      <li>Show the highest-leverage AI opportunities inside your business</li>
      <li>Map whether a roadmap, done-with-you implementation, done-for-you buildout, or a different recommendation fits the stated need</li>
    </ul>
    <p style="font-size:15px;color:#555;">Direct booking link, if you need it later: <a href="${calendlyUrl}" style="color:#2459c8;">Book your Free Clarity Call</a>.</p>
    <p style="font-size:17px;">No fluff. No generic AI talk. Just clarity.</p>
    <p style="font-size:17px;">Talk soon,<br/>Robin &amp; the GrowthEko team</p>
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;" />
    <p style="font-size:12px;color:#999;">GrowthEko | growtheko.com<br/>You're receiving this because you applied at growtheko.com/apply<br/>${GROWTHEKO_PUBLIC_EMAIL}</p>
  </div>
</div>`;
  }

  const emailPayload = {
    from: RESEND_FROM,
    to: [data.email],
    subject,
    html
  };
  const response = await checkedFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `growtheko-apply-${createHash('sha256').update(`${data.email}:${data.selected_tier}`).digest('hex').slice(0, 32)}`
    },
    body: JSON.stringify(emailPayload)
  }, 'resend_email');
  const result = await response.json().catch(() => null);
  if (!result || !result.id) throw new Error('resend_email_invalid_response');
  return result.id;
}

function applicationRecord(data, submittedAt, includeNewFields = false) {
  const record = {
    email: data.email,
    first_name: data.first_name,
    last_name: data.last_name,
    website: data.website || null,
    motivation: data.motivation,
    motivation_other: data.motivation_other || null,
    profile_type: data.profile_type,
    creator_name: data.creator_name || null,
    content_niche: data.content_niche || null,
    platforms: data.platforms,
    product_type: data.product_type,
    revenue_stage: data.revenue_stage,
    primary_geo_market: data.primary_geo_market,
    additional_markets: data.additional_markets,
    company_size: data.company_size,
    holding_back: data.holding_back,
    goal: data.goal || null,
    urgency: data.urgency,
    investment_readiness: data.investment_readiness,
    selected_tier: data.selected_tier,
    submitted_at: submittedAt
  };
  if (includeNewFields) {
    record.monthly_revenue = data.revenue_stage;
    record.biggest_challenge = data.holding_back;
    record.status = 'new';
  }
  return record;
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let data;
  try {
    data = normalizeApplication(req.body?.data);
  } catch (error) {
    const message = error.message === 'invalid_offer' ? 'Select the support path that interests you most' : 'Missing or invalid application fields';
    return res.status(400).json({ error: message });
  }

  if (isRateLimited(req, data.email)) {
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many application attempts. Please retry later.' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.GROWTHEKO_SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM || process.env.GROWTHEKO_RESEND_FROM || GROWTHEKO_RESEND_FROM;
  if (!supabaseUrl || !supabaseKey || !resendKey || !resendFrom) {
    return res.status(503).json({ error: 'Application service is not configured. Please retry later.' });
  }

  if (inFlightEmails.has(data.email)) {
    return res.status(409).json({ error: 'This application is already being processed.' });
  }
  inFlightEmails.add(data.email);

  const supabaseHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  };

  try {
    const submittedAt = new Date().toISOString();
    const applicationUrl = `${supabaseUrl}/rest/v1/applications`;
    const lookupUrl = `${applicationUrl}?email=eq.${encodeURIComponent(data.email)}&select=id&limit=1`;
    const checkRes = await checkedFetch(lookupUrl, { headers: supabaseHeaders }, 'supabase_application_lookup');
    const existing = await checkRes.json();
    if (!Array.isArray(existing)) throw new Error('supabase_application_lookup_invalid_response');

    const isReturning = existing.length > 0;
    if (isReturning) {
      await checkedFetch(`${applicationUrl}?email=eq.${encodeURIComponent(data.email)}`, {
        method: 'PATCH',
        headers: {
          ...supabaseHeaders,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(applicationRecord(data, submittedAt))
      }, 'supabase_application_update');
    } else {
      await checkedFetch(applicationUrl, {
        method: 'POST',
        headers: {
          ...supabaseHeaders,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(applicationRecord(data, submittedAt, true))
      }, 'supabase_application_insert');
    }

    await sendConfirmationEmail(data, isReturning);
    return res.status(200).json({ success: true, stored: true, emailSent: true });
  } catch (error) {
    console.error('Application processing failed:', error.message);
    return res.status(502).json({ error: 'Application could not be saved and confirmed. Please retry.' });
  } finally {
    inFlightEmails.delete(data.email);
  }
}
