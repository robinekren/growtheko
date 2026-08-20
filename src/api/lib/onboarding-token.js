import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export function createOnboardingToken({ email, tier, stripeCustomerId }, secret, {
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = DEFAULT_TTL_SECONDS
} = {}) {
  assertSecret(secret);
  const normalizedEmail = normalizeEmail(email);
  const normalizedTier = normalizeTier(tier);
  const customerId = normalizeCustomerId(stripeCustomerId);
  if (!normalizedEmail || !normalizedTier || !customerId) throw new Error('Invalid onboarding token claims');

  const payload = {
    v: 1,
    eh: emailHash(normalizedEmail, secret),
    t: normalizedTier,
    c: customerId,
    exp: nowSeconds + Math.min(DEFAULT_TTL_SECONDS, Math.max(300, Number(ttlSeconds) || DEFAULT_TTL_SECONDS))
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

export function verifyOnboardingToken(token, { email, expectedTier }, secret, {
  nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  assertSecret(secret);
  const [body, signature, extra] = String(token || '').split('.');
  if (!body || !signature || extra) throw new Error('Invalid onboarding token');

  const expectedSignature = sign(body, secret);
  if (!secureEqual(signature, expectedSignature)) throw new Error('Invalid onboarding token');

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid onboarding token');
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedTier = normalizeTier(expectedTier);
  if (
    payload?.v !== 1 ||
    !normalizedEmail ||
    payload.eh !== emailHash(normalizedEmail, secret) ||
    !normalizeCustomerId(payload.c) ||
    !normalizeTier(payload.t) ||
    !Number.isInteger(payload.exp) ||
    payload.exp < nowSeconds ||
    (normalizedTier && payload.t !== normalizedTier)
  ) {
    throw new Error('Invalid or expired onboarding token');
  }

  return { tier: payload.t, stripeCustomerId: payload.c, expiresAt: payload.exp };
}

export function appendOnboardingToken(urlValue, token) {
  const url = new URL(urlValue);
  url.searchParams.set('token', token);
  return url.toString();
}

function emailHash(email, secret) {
  return createHmac('sha256', secret).update(`email:${email}`, 'utf8').digest('base64url');
}

function sign(body, secret) {
  return createHmac('sha256', secret).update(`onboard:${body}`, 'utf8').digest('base64url');
}

function secureEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertSecret(secret) {
  if (Buffer.byteLength(String(secret || ''), 'utf8') < 32) {
    throw new Error('Onboarding token secret is not configured');
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeTier(value) {
  const tier = String(value || '').trim().toLowerCase();
  return /^(monthly_97|onetime_1997)$/.test(tier) ? tier : null;
}

function normalizeCustomerId(value) {
  const id = String(value || '').trim();
  return /^cus_[A-Za-z0-9]+$/.test(id) ? id : null;
}
