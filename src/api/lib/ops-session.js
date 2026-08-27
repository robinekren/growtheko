import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'growtheko_ops_session';
const MAX_AGE_SECONDS = 8 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function secret() {
  return String(process.env.GROWTHEKO_OPS_SESSION_SECRET || '');
}

export function isLocalDevelopmentRequest(req, env = process.env) {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'development') return false;
  if (!env.VERCEL_ENV && env.NODE_ENV === 'production') return false;
  const rawHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '');
  try {
    const hostname = new URL(`http://${rawHost}`).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function cookieValue() {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `v1.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function createOpsCookie({ secure = true } = {}) {
  if (secret().length < 32) throw new Error('GROWTHEKO_OPS_SESSION_SECRET is not configured');
  const parts = [
    `${COOKIE_NAME}=${cookieValue()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${MAX_AGE_SECONDS}`
  ];
  if (secure) parts.splice(3, 0, 'Secure');
  return parts.join('; ');
}

export function hasOpsSession(cookieHeader = '') {
  if (secret().length < 32) return false;
  const entry = String(cookieHeader).split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return false;
  const value = entry.slice(COOKIE_NAME.length + 1);
  const [version, expiresRaw, signature] = value.split('.');
  if (version !== 'v1' || !/^\d+$/.test(expiresRaw || '') || !signature) return false;
  if (Number(expiresRaw) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, sign(`${version}.${expiresRaw}`));
}

export function isSameOrigin(req) {
  const origin = String(req.headers?.origin || '');
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
