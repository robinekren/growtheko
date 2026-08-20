const ALLOWED_ORIGINS = new Set([
  'https://growtheko.com',
  'https://www.growtheko.com',
  'http://localhost:4310',
  'http://127.0.0.1:4310'
]);
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMISSIONS = 5;
const buckets = globalThis.__growthekoContactBuckets || new Map();
globalThis.__growthekoContactBuckets = buckets;

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function bodyObject(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) return body;
  try {
    const parsed = JSON.parse(String(body || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rateLimited(req, email) {
  const forwarded = clean(req.headers?.['x-forwarded-for'], 300).split(',')[0].trim();
  const ip = forwarded || clean(req.headers?.['x-real-ip'], 100) || 'unknown';
  const key = `${ip}:${email}`;
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter(timestamp => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_SUBMISSIONS) return true;
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 1000) {
    for (const [bucketKey, timestamps] of buckets) {
      if (!timestamps.some(timestamp => now - timestamp < WINDOW_MS)) buckets.delete(bucketKey);
    }
  }
  return false;
}

function sameOrigin(req, res) {
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

export default async function handler(req, res) {
  if (!sameOrigin(req, res)) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json is required' });
  }

  const raw = bodyObject(req.body);
  if (!raw) return res.status(400).json({ error: 'Invalid JSON body' });
  const submission = {
    reason: clean(raw.reason, 100),
    name: clean(raw.name, 160),
    message: clean(raw.message, 5000),
    urgency: clean(raw.urgency, 100),
    email: clean(raw.email, 254).toLowerCase()
  };
  if (
    !submission.reason || !submission.name || !submission.message || !submission.urgency ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)
  ) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }
  if (rateLimited(req, submission.email)) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  const baseUrl = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const serviceKey = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(baseUrl) || !serviceKey) {
    return res.status(503).json({ error: 'Contact service is unavailable.' });
  }

  try {
    const response = await fetch(`${baseUrl}/rest/v1/contact_submissions`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(submission)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload) || !payload[0]?.id) {
      console.error('Contact storage failed.', { status: response.status });
      return res.status(502).json({ error: 'Contact service is temporarily unavailable.' });
    }
    return res.status(200).json({ success: true, id: payload[0].id });
  } catch (error) {
    console.error('Contact storage request failed.', { name: error?.name || 'Error' });
    return res.status(502).json({ error: 'Contact service is temporarily unavailable.' });
  }
}
