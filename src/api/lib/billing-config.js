import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BILLING_TERMS_VERSION } from './offer-registry.js';

export const DEFAULT_BILLING_BASE_URL = 'https://www.growtheko.com';
export const PORTAL_COOKIE_NAME = 'ge_billing_portal';
export { BILLING_TERMS_VERSION };

export const OFFER_DEFINITIONS = Object.freeze({
  monthly_97: Object.freeze({
    key: 'monthly_97',
    envKey: 'STRIPE_PRICE_MONTHLY_97',
    mode: 'subscription',
    unitAmount: 9700,
    recurring: true
  }),
  onetime_1997: Object.freeze({
    key: 'onetime_1997',
    envKey: 'STRIPE_PRICE_ONETIME_1997',
    mode: 'payment',
    unitAmount: 199700,
    recurring: false
  })
});

export class BillingInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'BillingInputError';
    this.code = code;
    this.status = status;
  }
}

export class BillingSetupError extends Error {
  constructor(code = 'billing_not_configured') {
    super('Billing is not configured correctly.');
    this.name = 'BillingSetupError';
    this.code = code;
    this.status = 503;
  }
}

export function getHeader(req, name) {
  const headers = req?.headers || {};
  const target = name.toLowerCase();
  const direct = headers[target] ?? headers[name];
  if (Array.isArray(direct)) return direct[0];
  if (direct !== undefined) return String(direct);

  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === target);
  const value = matchingKey ? headers[matchingKey] : undefined;
  return Array.isArray(value) ? value[0] : value === undefined ? undefined : String(value);
}

export function resolveBillingBaseUrl(env = process.env) {
  const configured = String(env.BILLING_BASE_URL || DEFAULT_BILLING_BASE_URL).trim();

  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('invalid base URL');
    }
    return parsed.origin;
  } catch {
    throw new BillingSetupError('invalid_billing_base_url');
  }
}

export function applySameOriginCors(req, res, baseUrl) {
  const origin = getHeader(req, 'origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');

  if (!origin) return true;
  if (origin !== baseUrl) return false;

  res.setHeader('Access-Control-Allow-Origin', baseUrl);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

export function requireJsonRequest(req) {
  const contentType = getHeader(req, 'content-type');
  return Boolean(contentType && contentType.toLowerCase().split(';', 1)[0].trim() === 'application/json');
}

export function parseJsonBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    return body;
  }

  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try {
      const parsed = JSON.parse(String(body));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the stable public error below.
    }
  }

  throw new BillingInputError('invalid_json', 'A JSON object is required.');
}

export function parseCheckoutInput(body) {
  const input = parseJsonBody(body);
  const offer = typeof input.offer === 'string' ? input.offer.trim() : '';
  if (!Object.hasOwn(OFFER_DEFINITIONS, offer)) {
    throw new BillingInputError('invalid_offer', 'Unknown offer.');
  }

  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new BillingInputError('invalid_request_id', 'A valid requestId is required.');
  }

  const companyName = typeof input.companyName === 'string' ? input.companyName.trim() : '';
  if (companyName.length < 2 || companyName.length > 160) {
    throw new BillingInputError('invalid_company_name', 'A companyName is required.');
  }

  const buyerCountry = typeof input.buyerCountry === 'string'
    ? input.buyerCountry.trim().toUpperCase()
    : '';
  if (!/^[A-Z]{2}$/.test(buyerCountry)) {
    throw new BillingInputError('invalid_buyer_country', 'A two-letter buyerCountry is required.');
  }
  if (buyerCountry !== 'AT') {
    throw new BillingInputError(
      'manual_review_required',
      'This order requires manual review.',
      422
    );
  }

  const rawEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!rawEmail || rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    throw new BillingInputError('invalid_email', 'The email address is invalid.');
  }

  if (input.acceptsB2B !== true) {
    throw new BillingInputError('b2b_attestation_required', 'Business purchaser confirmation is required.');
  }
  if (input.acceptsTerms !== true || input.termsVersion !== BILLING_TERMS_VERSION) {
    throw new BillingInputError('terms_acceptance_required', 'Current Terms acceptance is required.');
  }
  if (input.acceptsElectronicInvoices !== true) {
    throw new BillingInputError('electronic_invoice_consent_required', 'Electronic invoice consent is required.');
  }
  const acceptedAt = typeof input.acceptedAt === 'string' ? input.acceptedAt.trim() : '';
  const acceptedAtMs = Date.parse(acceptedAt);
  if (
    !acceptedAt ||
    !Number.isFinite(acceptedAtMs) ||
    Math.abs(Date.now() - acceptedAtMs) > 15 * 60 * 1000
  ) {
    throw new BillingInputError('invalid_acceptance_time', 'A current acceptance timestamp is required.');
  }

  return {
    offer,
    requestId,
    companyName,
    buyerCountry,
    email: rawEmail,
    acceptsB2B: true,
    acceptsTerms: true,
    acceptsElectronicInvoices: true,
    termsVersion: BILLING_TERMS_VERSION,
    acceptedAt: new Date(acceptedAtMs).toISOString()
  };
}

export function getStripeSecretKey(env = process.env) {
  const secretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) throw new BillingSetupError();
  return secretKey;
}

export function requireBillingLive(env = process.env) {
  if (env.GROWTHEKO_BILLING_LIVE_ENABLED !== 'true') {
    throw new BillingSetupError('billing_not_live');
  }
}

export function getOffer(input, env = process.env) {
  const definition = OFFER_DEFINITIONS[input.offer];
  const priceId = String(env[definition.envKey] || '').trim();
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new BillingSetupError('invalid_price_configuration');
  }
  return { ...definition, priceId };
}

export function assertStripePrice(price, offer) {
  const commonValid =
    price &&
    price.id === offer.priceId &&
    price.active === true &&
    String(price.currency || '').toLowerCase() === 'usd' &&
    price.unit_amount === offer.unitAmount &&
    price.tax_behavior === 'exclusive';

  const cadenceValid = offer.recurring
    ? price?.type === 'recurring' &&
      price?.recurring?.interval === 'month' &&
      price?.recurring?.interval_count === 1
    : price?.type === 'one_time' && !price?.recurring;

  if (!commonValid || !cadenceValid) {
    throw new BillingSetupError('stripe_price_mismatch');
  }
}

export function getPortalCookieSecret(env = process.env) {
  const secret = String(env.BILLING_PORTAL_COOKIE_SECRET || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new BillingSetupError('invalid_portal_cookie_secret');
  }
  return secret;
}

export function derivePortalToken(requestId, secret) {
  return createHmac('sha256', secret)
    .update(`growtheko-portal:${requestId}`, 'utf8')
    .digest('base64url');
}

export function hashPortalToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function portalTokenMatches(token, expectedHash) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return false;
  if (!/^[a-f0-9]{64}$/.test(String(expectedHash || ''))) return false;

  const actual = Buffer.from(hashPortalToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildCustomerParams(input) {
  const params = {
    name: input.companyName,
    metadata: {
      request_id: input.requestId,
      buyer_country: input.buyerCountry,
      billing_scope: 'at_b2b_phase_1',
      offer: input.offer,
      terms_version: input.termsVersion,
      terms_accepted_at: input.acceptedAt,
      b2b_attested: 'true',
      electronic_invoice_consented: 'true'
    }
  };
  if (input.email) params.email = input.email;
  return params;
}

export function buildCheckoutSessionParams(input, offer, customerId, baseUrl, portalTokenHash) {
  const metadata = {
    offer: offer.key,
    request_id: input.requestId,
    buyer_country: input.buyerCountry,
    company_name: input.companyName,
    billing_scope: 'at_b2b_phase_1',
    portal_token_hash: portalTokenHash,
    terms_version: input.termsVersion,
    terms_accepted_at: input.acceptedAt,
    b2b_attested: 'true',
    electronic_invoice_consented: 'true'
  };

  const params = {
    mode: offer.mode,
    customer: customerId,
    client_reference_id: input.requestId,
    line_items: [{ price: offer.priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { address: 'auto' },
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/playbook?checkout=cancelled`,
    metadata
  };

  if (offer.mode === 'subscription') {
    params.subscription_data = { metadata };
  } else {
    params.payment_intent_data = { metadata };
    params.invoice_creation = {
      enabled: true,
      invoice_data: { metadata }
    };
  }

  return params;
}

export function setPortalCookie(res, token) {
  const maxAgeSeconds = 30 * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${PORTAL_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; Path=/api/create-billing-portal; HttpOnly; Secure; SameSite=Lax`
  );
}

export function readPortalCookie(req) {
  const cookieHeader = getHeader(req, 'cookie') || '';
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    const name = cookie.slice(0, separator).trim();
    if (name !== PORTAL_COOKIE_NAME) continue;
    return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

export function parsePortalInput(body) {
  const input = parseJsonBody(body);
  const checkoutSessionId = typeof input.checkoutSessionId === 'string'
    ? input.checkoutSessionId.trim()
    : '';
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{8,}$/.test(checkoutSessionId)) {
    throw new BillingInputError('invalid_checkout_session', 'A checkoutSessionId is required.');
  }
  return { checkoutSessionId };
}
