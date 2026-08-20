import Stripe from 'stripe';
import {
  BillingInputError,
  BillingSetupError,
  applySameOriginCors,
  assertStripePrice,
  buildCheckoutSessionParams,
  buildCustomerParams,
  derivePortalToken,
  getOffer,
  getPortalCookieSecret,
  getStripeSecretKey,
  hashPortalToken,
  parseCheckoutInput,
  requireBillingLive,
  requireJsonRequest,
  resolveBillingBaseUrl,
  setPortalCookie
} from './lib/billing-config.js';

function sendError(res, status, code, message, extra = undefined) {
  const payload = { error: { code, message } };
  if (extra) Object.assign(payload, extra);
  return res.status(status).json(payload);
}

function safeStripeLog(logger, label, error) {
  logger.error(label, {
    type: typeof error?.type === 'string' ? error.type : 'unknown',
    code: typeof error?.code === 'string' ? error.code : 'unknown'
  });
}

export function createCheckoutHandler({
  env = process.env,
  stripeFactory = (secretKey) => new Stripe(secretKey),
  logger = console
} = {}) {
  return async function handler(req, res) {
    let baseUrl;
    try {
      baseUrl = resolveBillingBaseUrl(env);
    } catch (error) {
      return sendError(res, 503, error.code || 'billing_not_configured', 'Billing is unavailable.');
    }

    if (!applySameOriginCors(req, res, baseUrl)) {
      return sendError(res, 403, 'origin_not_allowed', 'Origin is not allowed.');
    }

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
    }
    if (!requireJsonRequest(req)) {
      return sendError(res, 415, 'json_required', 'Content-Type application/json is required.');
    }

    let input;
    let offer;
    let secretKey;
    let portalSecret;
    try {
      requireBillingLive(env);
      input = parseCheckoutInput(req.body);
      offer = getOffer(input, env);
      secretKey = getStripeSecretKey(env);
      portalSecret = getPortalCookieSecret(env);
    } catch (error) {
      if (error instanceof BillingInputError) {
        const extra = error.status === 422 ? { manualReview: true } : undefined;
        return sendError(res, error.status, error.code, error.message, extra);
      }
      if (error instanceof BillingSetupError) {
        return sendError(res, 503, error.code, 'Billing is unavailable.');
      }
      return sendError(res, 400, 'invalid_request', 'The request is invalid.');
    }

    const stripe = stripeFactory(secretKey);
    const portalToken = derivePortalToken(input.requestId, portalSecret);
    const portalTokenHash = hashPortalToken(portalToken);

    try {
      const stripePrice = await stripe.prices.retrieve(offer.priceId);
      assertStripePrice(stripePrice, offer);

      // Email alone is not an identity proof. Each unauthenticated checkout gets
      // an isolated Stripe Customer so a buyer cannot gain portal access to an
      // existing customer's invoices or subscriptions by typing that email.
      const customer = await stripe.customers.create(
        buildCustomerParams(input),
        { idempotencyKey: `growtheko-customer:${input.requestId}` }
      );
      if (!customer?.id) throw new Error('customer missing');

      const session = await stripe.checkout.sessions.create(
        buildCheckoutSessionParams(input, offer, customer.id, baseUrl, portalTokenHash),
        { idempotencyKey: `growtheko-checkout:${input.requestId}` }
      );
      if (!session?.url) throw new Error('checkout URL missing');

      setPortalCookie(res, portalToken);
      return res.status(200).json({ checkoutUrl: session.url });
    } catch (error) {
      if (error instanceof BillingSetupError) {
        logger.error('Stripe price configuration rejected.', { code: error.code });
        return sendError(res, 503, error.code, 'Billing is unavailable.');
      }
      safeStripeLog(logger, 'Stripe checkout creation failed.', error);
      return sendError(res, 502, 'checkout_unavailable', 'Checkout is temporarily unavailable.');
    }
  };
}


export default createCheckoutHandler();
