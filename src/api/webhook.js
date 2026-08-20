// Stripe is the payment/subscription source. Supabase stores an idempotent,
// auditable mirror for entitlements and downstream invoicing/onboarding jobs.
//
// Required environment variables (values must never be committed):
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   GROWTHEKO_SUPABASE_URL
//   GROWTHEKO_SUPABASE_SERVICE_KEY

import Stripe from 'stripe';
import {
  authorizeGrowthEkoBillingEvent,
  BillingPolicySetupError,
  BillingScopeError
} from './lib/billing-event-policy.js';
import {
  processVerifiedStripeEvent,
  readRawBody,
  verifyStripeEvent
} from './_billing-webhook-core.js';
import { SupabaseBillingRepository } from './_supabase-billing-repository.js';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.GROWTHEKO_SUPABASE_URL;
  const supabaseServiceKey = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('[STRIPE] Webhook infrastructure is not fully configured');
    return res.status(500).json({ error: 'Webhook is not configured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    const tooLarge = error?.code === 'WEBHOOK_BODY_TOO_LARGE';
    console.warn(`[STRIPE] Rejected unreadable webhook body (${tooLarge ? 'too_large' : 'invalid'})`);
    return res.status(tooLarge ? 413 : 400).json({ error: 'Invalid webhook body' });
  }

  const stripe = new Stripe(stripeSecretKey, { maxNetworkRetries: 0 });
  const signatureHeader = req.headers['stripe-signature'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  let event;
  try {
    event = verifyStripeEvent({
      rawBody,
      signature,
      secret: webhookSecret,
      constructEvent: stripe.webhooks.constructEvent.bind(stripe.webhooks)
    });
  } catch (error) {
    console.warn(`[STRIPE] Signature verification failed: ${safeLogMessage(error)}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    event = await hydrateStripeEvent(event, { stripe });
  } catch (error) {
    // Dispute objects do not carry a customer id by default. If the related
    // charge cannot be resolved, fail closed so Stripe retries instead of
    // recording a dispute that cannot suspend the correct entitlement.
    console.error(`[STRIPE] Event ${event.id} hydration failed: ${safeLogMessage(error)}`);
    return res.status(500).json({ error: 'Webhook enrichment failed' });
  }

  try {
    event = await authorizeGrowthEkoBillingEvent(event, { stripe, env: process.env });
  } catch (error) {
    if (error instanceof BillingScopeError) {
      console.info(`[STRIPE] Ignored out-of-scope event ${event.id}: ${safeLogMessage(error)}`);
      return res.status(200).json({ received: true, ignored: true });
    }
    if (error instanceof BillingPolicySetupError) {
      console.error(`[STRIPE] Billing event policy is not configured: ${safeLogMessage(error)}`);
      return res.status(500).json({ error: 'Webhook policy is not configured' });
    }
    console.error(`[STRIPE] Event ${event.id} policy check failed: ${safeLogMessage(error)}`);
    return res.status(500).json({ error: 'Webhook policy check failed' });
  }

  const repository = new SupabaseBillingRepository({
    url: supabaseUrl,
    serviceKey: supabaseServiceKey
  });

  try {
    const result = await processVerifiedStripeEvent(event, { repository });
    if (result.duplicate && result.status === 'processing') {
      // A concurrent delivery is still running. Do not acknowledge success yet:
      // if that worker crashes, Stripe must retain a retry opportunity.
      return res.status(409).json({ received: false, retry: true });
    }
    return res.status(200).json({
      received: true,
      processed: Boolean(result.processed),
      duplicate: Boolean(result.duplicate),
      ignored: Boolean(result.ignored)
    });
  } catch (error) {
    // Returning 5xx is intentional: Stripe retries, while the event ledger
    // prevents already-applied transitions from being applied twice.
    console.error(`[STRIPE] Event ${event.id} failed: ${safeLogMessage(error)}`);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

export async function hydrateStripeEvent(event, { stripe }) {
  if (!String(event?.type || '').startsWith('charge.dispute.')) return event;

  const dispute = event?.data?.object;
  if (!dispute || typeof dispute !== 'object') throw new Error('Missing dispute object');
  if (typeof dispute.customer === 'string' && dispute.customer.startsWith('cus_')) return event;

  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId || !chargeId.startsWith('ch_')) throw new Error('Missing dispute charge id');

  const charge = await stripe.charges.retrieve(chargeId);
  const customerId = typeof charge?.customer === 'string' ? charge.customer : charge?.customer?.id;
  if (!customerId || !customerId.startsWith('cus_')) {
    throw new Error('Dispute charge customer is unavailable');
  }

  const paymentIntentId = typeof charge?.payment_intent === 'string'
    ? charge.payment_intent
    : charge?.payment_intent?.id;

  return {
    ...event,
    data: {
      ...event.data,
      object: {
        ...dispute,
        customer: customerId,
        charge: chargeId,
        invoice: dispute.invoice || (typeof charge?.invoice === 'string' ? charge.invoice : charge?.invoice?.id) || null,
        payment_intent: dispute.payment_intent || paymentIntentId || null
      }
    }
  };
}

function safeLogMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}
