import { timingSafeEqual } from 'node:crypto';

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const cronSecret = String(process.env.CRON_SECRET || '');
  if (!cronSecret || !equal(req.headers?.authorization, `Bearer ${cronSecret}`)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const base = String(process.env.GROWTHEKO_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY || '');
  if (!base || !serviceKey) return res.status(503).json({ error: 'Retention service unavailable.' });

  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(
    `${base}/rest/v1/messages?message_type=eq.meeting_transcript&created_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=representation'
      }
    }
  );
  if (!response.ok) {
    console.error('fireflies-retention:', response.status);
    return res.status(503).json({ error: 'Retention service unavailable.' });
  }
  const deleted = await response.json().catch(() => []);
  return res.status(200).json({ deleted: Array.isArray(deleted) ? deleted.length : 0, cutoff });
}
