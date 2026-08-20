import Stripe from 'stripe';
import {
  BillingInputError,
  BillingSetupError,
  applySameOriginCors,
  getStripeSecretKey,
  parsePortalInput,
  portalTokenMatches,
  readPortalCookie,
  requireJsonRequest,
  resolveBillingBaseUrl
} from './lib/billing-config.js';

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function safeStripeLog(logger, label, error) {
  logger.error(label, {
    type: typeof error?.type === 'string' ? error.type : 'unknown',
    code: typeof error?.code === 'string' ? error.code : 'unknown'
  });
}

function portalConfigurationId(env) {
  const value = String(env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID || '').trim();
  const production =
    env.VERCEL_ENV === 'production' ||
    (!env.VERCEL_ENV && env.NODE_ENV === 'production');

  if (!value) {
    if (production) throw new Error('portal_configuration_missing');
    return null;
  }
  if (!/^bpc_[A-Za-z0-9]+$/.test(value)) {
    throw new Error('portal_configuration_invalid');
  }
  return value;
}

export function createBillingPortalHandler({
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

    let configurationId;
    try {
      configurationId = portalConfigurationId(env);
    } catch (error) {
      logger.error?.('Stripe billing portal configuration is not pinned.', {
        code: error instanceof Error ? error.message : 'portal_configuration_invalid'
      });
      return sendError(res, 503, 'portal_not_configured', 'Billing is unavailable.');
    }

    let input;
    let secretKey;
    try {
      input = parsePortalInput(req.body);
      secretKey = getStripeSecretKey(env);
    } catch (error) {
      if (error instanceof BillingInputError) {
        return sendError(res, error.status, error.code, error.message);
      }
      if (error instanceof BillingSetupError) {
        return sendError(res, 503, error.code, 'Billing is unavailable.');
      }
      return sendError(res, 400, 'invalid_request', 'The request is invalid.');
    }

    const portalToken = readPortalCookie(req);
    if (!portalToken) {
      return sendError(res, 401, 'portal_auth_required', 'Customer authentication is required.');
    }

    const stripe = stripeFactory(secretKey);
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(input.checkoutSessionId);
    } catch (error) {
      safeStripeLog(logger, 'Checkout session authentication failed.', error);
      return sendError(res, 401, 'portal_auth_failed', 'Customer authentication failed.');
    }

    const expectedTokenHash = checkoutSession?.metadata?.portal_token_hash;
    const authenticated =
      checkoutSession?.status === 'complete' &&
      checkoutSession?.payment_status === 'paid' &&
      checkoutSession?.metadata?.billing_scope === 'at_b2b_phase_1' &&
      portalTokenMatches(portalToken, expectedTokenHash);

    const customerId = typeof checkoutSession?.customer === 'string'
      ? checkoutSession.customer
      : checkoutSession?.customer?.id;

    if (!authenticated || !/^cus_[A-Za-z0-9]+$/.test(String(customerId || ''))) {
      return sendError(res, 401, 'portal_auth_failed', 'Customer authentication failed.');
    }

    try {
      const portalParams = {
        customer: customerId,
        return_url: `${baseUrl}/playbook?billing=return`
      };
      if (configurationId) portalParams.configuration = configurationId;
      const portalSession = await stripe.billingPortal.sessions.create(portalParams);
      if (!portalSession?.url) throw new Error('portal URL missing');
      return res.status(200).json({ portalUrl: portalSession.url });
    } catch (error) {
      safeStripeLog(logger, 'Stripe billing portal creation failed.', error);
      return sendError(res, 502, 'portal_unavailable', 'The billing portal is temporarily unavailable.');
    }
  };
}

export default createBillingPortalHandler();
