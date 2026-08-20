// Retired legacy portal/CRM bridge.
//
// This route previously trusted caller-supplied application IDs and exposed a
// direct message read/write bridge. It remains intentionally unavailable until
// a replacement binds every request to a server-verified customer session.

import { timingSafeEqual } from 'node:crypto';

const RETIRED_RESPONSE = Object.freeze({
  error: {
    code: 'legacy_portal_retired',
    message: 'This legacy portal endpoint is unavailable.'
  }
});

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function expectedOrigin(req) {
  const configured = process.env.GROWTHEKO_SITE_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return null;
  const protocol = header(req, 'x-forwarded-proto') || 'https';
  return `${protocol}://${host}`;
}

function sameOrigin(req) {
  const origin = header(req, 'origin');
  const expected = expectedOrigin(req);
  if (!origin || !expected) return false;

  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

function authorized(req, secret) {
  const authorization = header(req, 'authorization') || '';
  const candidate = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  const actual = Buffer.from(candidate);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Do not advertise this retired surface unless an operator deliberately
  // enables the audit gate. There is no permissive CORS response.
  if (process.env.GROWTHEKO_LEGACY_PORTAL_ENABLED !== 'true') {
    return res.status(404).json(RETIRED_RESPONSE);
  }

  const secret = process.env.GROWTHEKO_LEGACY_PORTAL_SECRET?.trim();
  if (!secret) {
    return res.status(503).json(RETIRED_RESPONSE);
  }

  if (!sameOrigin(req)) {
    return res.status(403).json(RETIRED_RESPONSE);
  }

  if (!authorized(req, secret)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json(RETIRED_RESPONSE);
  }

  // Even an authenticated operator cannot read or mutate legacy customer
  // data. This gate only makes the retirement explicit during internal audits.
  return res.status(410).json(RETIRED_RESPONSE);
}
