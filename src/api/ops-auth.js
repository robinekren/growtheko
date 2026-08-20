import { createHash, timingSafeEqual } from 'node:crypto';

const PASSWORD_HASH = '568418731c294058ab7a5384d32d9616731215a451ea5161809b0f4e577d31d8';
const SESSION_VALUE = 'ops_568418731c294058ab7a5384d32d9616731215a451ea5161809b0f4e577d31d8';

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

  const body = parseBody(req.body);
  const passwordHash = hash(body.password);
  if (!safeEqual(passwordHash, PASSWORD_HASH)) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  res.setHeader(
    'Set-Cookie',
    [
      `growtheko_ops_session=${SESSION_VALUE}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Max-Age=86400'
    ].join('; ')
  );
  return res.status(200).json({ ok: true, redirect: '/ops' });
}
