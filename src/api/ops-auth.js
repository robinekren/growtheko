import { createHash, timingSafeEqual } from 'node:crypto';
import { createOpsCookie, isSameOrigin } from './lib/ops-session.js';

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
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

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request unavailable' });

  const expectedHash = String(process.env.GROWTHEKO_OPS_PASSWORD_HASH || '');
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return res.status(503).json({ ok: false, error: 'Ops access is not configured' });
  }

  const body = parseBody(req.body);
  const passwordHash = hash(body.password);
  if (!safeEqual(passwordHash, expectedHash)) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  res.setHeader('Set-Cookie', createOpsCookie());
  return res.status(200).json({ ok: true, redirect: '/crm' });
}
