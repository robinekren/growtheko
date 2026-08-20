const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.tax_id.created',
  'customer.tax_id.updated',
  'customer.tax_id.deleted',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.refunded',
  'credit_note.created',
  'credit_note.updated',
  'credit_note.voided',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated'
]);

const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export async function readRawBody(req, maxBytes = MAX_WEBHOOK_BYTES) {
  const chunks = [];
  let received = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      const error = new Error('Stripe webhook body is too large');
      error.code = 'WEBHOOK_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export function verifyStripeEvent({ rawBody, signature, secret, constructEvent }) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('Stripe signature verification requires the raw Buffer');
  }
  if (!signature || typeof signature !== 'string') {
    throw new Error('Missing Stripe-Signature header');
  }
  if (!secret) {
    throw new Error('Missing Stripe webhook secret');
  }
  if (typeof constructEvent !== 'function') {
    throw new TypeError('Stripe constructEvent function is required');
  }

  return constructEvent(rawBody, signature, secret);
}

export function normalizeStripeEvent(event) {
  if (!event?.id || !event?.type || !event?.data?.object) {
    throw new TypeError('Malformed Stripe event');
  }

  const object = event.data.object;
  const createdAt = unixToIso(event.created) || new Date(0).toISOString();
  const base = {
    event_id: event.id,
    event_type: event.type,
    created_at: createdAt,
    livemode: Boolean(event.livemode),
    object_id: object.id || null,
    scope_validated: event.growtheko_scope_validated === true,
    authorized_offer_key: event.growtheko_offer_key || null,
    authorized_customer_id: event.growtheko_customer_id || null,
    authorized_invoice_id: event.growtheko_invoice_id || null,
    authorized_invoice_total: integerOrNull(event.growtheko_invoice_total),
    handled: HANDLED_EVENT_TYPES.has(event.type),
    customer: null,
    subscription: null,
    invoice: null,
    adjustment: null,
    tax_id: null,
    acceptance: null,
    entitlement_status: null
  };

  if (!base.handled) return base;

  switch (event.type) {
    case 'checkout.session.completed':
      return normalizeCheckout(base, object);
    case 'invoice.paid':
      return normalizeInvoice(base, object, true);
    case 'invoice.payment_failed':
      return normalizeInvoice(base, object, false);
    case 'customer.subscription.updated':
      return normalizeSubscription(base, object, 'updated');
    case 'customer.subscription.deleted':
      return normalizeSubscription(base, object, 'deleted');
    case 'customer.subscription.paused':
      return normalizeSubscription(base, object, 'paused');
    case 'customer.subscription.resumed':
      return normalizeSubscription(base, object, 'resumed');
    case 'customer.tax_id.created':
    case 'customer.tax_id.updated':
      return normalizeTaxId(base, object, 'active');
    case 'customer.tax_id.deleted':
      return normalizeTaxId(base, object, 'deleted');
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
      return normalizeRefund(base, object);
    case 'charge.refunded':
      return normalizeChargeRefund(base, object);
    case 'credit_note.created':
    case 'credit_note.updated':
    case 'credit_note.voided':
      return normalizeCreditNote(base, object);
    default:
      return normalizeDispute(base, object);
  }
}

export async function processVerifiedStripeEvent(event, { repository, logger = console }) {
  if (!repository) throw new TypeError('Billing repository is required');

  const normalized = normalizeStripeEvent(event);
  if (normalized.handled && !normalized.scope_validated) {
    throw new Error('Handled Stripe event was not validated against the GrowthEko billing policy');
  }
  const claim = await repository.claimEvent(normalized);

  if (!claim?.claimed) {
    logger.info?.(`[STRIPE] Duplicate/in-flight event ${event.id} (${claim?.status || 'unknown'})`);
    return {
      received: true,
      duplicate: true,
      status: claim?.status || 'unknown',
      eventId: event.id
    };
  }

  if (!normalized.handled) {
    await repository.finishEvent(event.id, 'ignored');
    return { received: true, ignored: true, eventId: event.id };
  }

  try {
    const result = await repository.applyEvent(normalized);
    await repository.finishEvent(event.id, 'processed');
    return {
      received: true,
      processed: true,
      eventId: event.id,
      result: result || null
    };
  } catch (error) {
    try {
      await repository.finishEvent(event.id, 'failed', safeErrorMessage(error));
    } catch (markError) {
      logger.error?.(`[STRIPE] Could not mark ${event.id} failed`, markError);
    }
    throw error;
  }
}

function normalizeCheckout(base, session) {
  const metadata = session.metadata || {};
  const customerId = stripeId(session.customer);
  const email = normalizeEmail(session.customer_details?.email || session.customer_email);
  const tier = tierFromMetadata(metadata);
  const billingCountry = normalizeCountry(session.customer_details?.address?.country);
  const manualReviewRequired = billingCountry !== 'AT';

  return {
    ...base,
    acceptance: {
      request_id: metadata.request_id || session.client_reference_id || null,
      checkout_session_id: session.id,
      stripe_customer_id: customerId,
      offer_key: tier,
      email,
      company_name: session.customer_details?.name || metadata.company_name || null,
      terms_version: metadata.terms_version || null,
      accepted_at: metadata.terms_accepted_at || null,
      b2b_attested: metadata.b2b_attested === 'true',
      electronic_invoice_consented: metadata.electronic_invoice_consented === 'true'
    },
    customer: {
      stripe_customer_id: customerId,
      email,
      name: session.customer_details?.name || metadata.customer_name || null,
      tier,
      billing_status: manualReviewRequired ? 'manual_review' : 'checkout_complete',
      billing_country: billingCountry,
      manual_review_required: manualReviewRequired,
      checkout_session_id: session.id,
      subscription_id: stripeId(session.subscription),
      currency: normalizeCurrency(session.currency),
      amount_paid: integerOrNull(session.amount_total),
      paid_at: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false
    },
    subscription: session.subscription
      ? {
          stripe_subscription_id: stripeId(session.subscription),
          stripe_customer_id: customerId,
          status: 'checkout_complete',
          price_id: null,
          product_id: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false,
          canceled_at: null,
          latest_invoice_id: null
        }
      : null,
    // Checkout confirms collection of buyer details, not durable entitlement.
    entitlement_status: null
  };
}

function normalizeInvoice(base, invoice, paid) {
  const line = invoice.lines?.data?.[0] || null;
  const subscriptionId = stripeId(
    invoice.subscription ||
      invoice.parent?.subscription_details?.subscription ||
      invoice.subscription_details?.subscription
  );
  const customerId = stripeId(invoice.customer);
  const metadata = {
    ...(invoice.subscription_details?.metadata || {}),
    ...(invoice.parent?.subscription_details?.metadata || {}),
    ...(line?.metadata || {}),
    ...(invoice.metadata || {})
  };
  const period = invoicePeriod(invoice);
  const paidAt = unixToIso(invoice.status_transitions?.paid_at);
  const tier = tierFromMetadata(metadata);
  const billingCountry = normalizeCountry(
    invoice.customer_address?.country || invoice.customer_shipping?.address?.country
  );
  const manualReviewRequired = billingCountry !== 'AT';

  return {
    ...base,
    customer: {
      stripe_customer_id: customerId,
      email: normalizeEmail(invoice.customer_email),
      name: invoice.customer_name || null,
      tier,
      billing_status: paid
        ? (manualReviewRequired ? 'manual_review' : 'active')
        : 'past_due',
      billing_country: billingCountry,
      manual_review_required: manualReviewRequired,
      checkout_session_id: null,
      subscription_id: subscriptionId,
      latest_invoice_id: invoice.id,
      currency: normalizeCurrency(invoice.currency),
      amount_paid: paid ? integerOrNull(invoice.amount_paid) : null,
      paid_at: paidAt || (paid ? base.created_at : null),
      current_period_start: period.start,
      current_period_end: period.end,
      cancel_at_period_end: false
    },
    subscription: subscriptionId
      ? {
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          status: paid ? 'active' : 'past_due',
          price_id: linePriceId(line),
          product_id: lineProductId(line),
          current_period_start: period.start,
          current_period_end: period.end,
          cancel_at_period_end: false,
          canceled_at: null,
          latest_invoice_id: invoice.id
        }
      : null,
    invoice: {
      stripe_invoice_id: invoice.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      status: invoice.status || (paid ? 'paid' : 'open'),
      paid,
      amount_paid: integerOrNull(invoice.amount_paid),
      amount_due: integerOrNull(invoice.amount_due),
      amount_remaining: integerOrNull(invoice.amount_remaining),
      subtotal: integerOrNull(invoice.subtotal),
      total: integerOrNull(invoice.total),
      currency: normalizeCurrency(invoice.currency),
      billing_reason: invoice.billing_reason || null,
      attempt_count: integerOrNull(invoice.attempt_count),
      next_payment_attempt: unixToIso(invoice.next_payment_attempt),
      period_start: period.start,
      period_end: period.end,
      paid_at: paidAt,
      hosted_invoice_url: httpsUrlOrNull(invoice.hosted_invoice_url),
      invoice_pdf: httpsUrlOrNull(invoice.invoice_pdf),
      payment_intent_id: stripeId(
        invoice.payment_intent || invoice.payments?.data?.[0]?.payment?.payment_intent
      ),
      charge_id: stripeId(invoice.charge),
      price_id: linePriceId(line),
      product_id: lineProductId(line),
      tier
    },
    entitlement_status: paid
      ? (manualReviewRequired ? 'manual_review' : 'paid')
      : 'past_due'
  };
}

function normalizeSubscription(base, subscription, transition) {
  const item = subscription.items?.data?.[0] || null;
  const deleted = transition === 'deleted';
  const paused = transition === 'paused' || subscription.status === 'paused';
  const resumed = transition === 'resumed';
  const status = deleted ? 'canceled' : paused ? 'paused' : subscription.status || 'unknown';
  const periodStart = unixToIso(subscription.current_period_start || item?.current_period_start);
  const periodEnd = unixToIso(subscription.current_period_end || item?.current_period_end);
  const tier = tierFromMetadata(subscription.metadata || {});
  const customerId = stripeId(subscription.customer);

  let entitlementStatus = null;
  if (deleted || ['canceled', 'incomplete_expired', 'unpaid'].includes(status)) {
    entitlementStatus = 'canceled';
  } else if (paused) {
    entitlementStatus = 'paused';
  } else if (status === 'past_due') {
    entitlementStatus = 'past_due';
  } else if (resumed && status === 'active') {
    // Stripe's resumed event confirms lifecycle state, not payment. Preserve
    // the paused entitlement until a separately verified invoice.paid event;
    // if that payment arrived first, a null transition also cannot regress it.
    entitlementStatus = null;
  }

  return {
    ...base,
    customer: {
      stripe_customer_id: customerId,
      email: null,
      name: null,
      tier,
      billing_status: status,
      billing_country: null,
      manual_review_required: false,
      checkout_session_id: null,
      subscription_id: subscription.id,
      latest_invoice_id: stripeId(subscription.latest_invoice),
      currency: normalizeCurrency(subscription.currency),
      amount_paid: null,
      paid_at: null,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
    },
    subscription: {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      status,
      price_id: stripeId(item?.price) || stripeId(item?.pricing?.price_details?.price),
      product_id: stripeId(item?.price?.product) || stripeId(item?.plan?.product),
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      canceled_at: unixToIso(subscription.canceled_at),
      latest_invoice_id: stripeId(subscription.latest_invoice)
    },
    entitlement_status: entitlementStatus
  };
}

function normalizeTaxId(base, taxId, lifecycleStatus) {
  const value = typeof taxId.value === 'string' ? taxId.value.replace(/\s/g, '') : '';
  return {
    ...base,
    customer: taxId.customer
      ? {
          stripe_customer_id: stripeId(taxId.customer),
          email: null,
          name: null,
          tier: null,
          billing_status: null,
          billing_country: null,
          manual_review_required: false,
          checkout_session_id: null,
          subscription_id: null,
          latest_invoice_id: null,
          currency: null,
          amount_paid: null,
          paid_at: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false
        }
      : null,
    tax_id: {
      stripe_tax_id: taxId.id,
      stripe_customer_id: stripeId(taxId.customer),
      type: taxId.type || null,
      value_last4: value ? value.slice(-4) : null,
      country: taxId.country || null,
      // Stripe's deleted Tax ID object has no separate lifecycle field. Keep
      // the tombstone in the audit mirror instead of silently ignoring it.
      validation_status: lifecycleStatus === 'deleted'
        ? 'deleted'
        : taxId.verification?.status || 'pending',
      verification_name: taxId.verification?.verified_name || null
    }
  };
}

function normalizeRefund(base, refund) {
  return {
    ...base,
    adjustment: {
      adjustment_key: `refund:${refund.id}`,
      stripe_object_id: refund.id,
      object_type: 'refund',
      stripe_customer_id: stripeId(refund.customer) || base.authorized_customer_id,
      stripe_invoice_id: stripeId(refund.invoice) || base.authorized_invoice_id,
      stripe_subscription_id: null,
      payment_intent_id: stripeId(refund.payment_intent),
      charge_id: stripeId(refund.charge),
      status: refund.status || null,
      amount: integerOrNull(refund.amount),
      currency: normalizeCurrency(refund.currency),
      reason: refund.reason || refund.failure_reason || null,
      full_adjustment: false
    }
  };
}

function normalizeChargeRefund(base, charge) {
  const isFull = Number.isInteger(charge.amount) && charge.amount_refunded >= charge.amount;
  return {
    ...base,
    customer: charge.customer
      ? {
          stripe_customer_id: stripeId(charge.customer),
          email: normalizeEmail(charge.billing_details?.email),
          name: charge.billing_details?.name || null,
          tier: base.authorized_offer_key,
          billing_status: isFull ? 'refunded' : 'partial_refund',
          billing_country: normalizeCountry(charge.billing_details?.address?.country),
          manual_review_required: false,
          checkout_session_id: null,
          subscription_id: null,
          latest_invoice_id: stripeId(charge.invoice),
          currency: normalizeCurrency(charge.currency),
          amount_paid: null,
          paid_at: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false
        }
      : null,
    adjustment: {
      adjustment_key: `charge_refund:${charge.id}`,
      stripe_object_id: charge.id,
      object_type: 'charge_refund',
      stripe_customer_id: stripeId(charge.customer) || base.authorized_customer_id,
      stripe_invoice_id: stripeId(charge.invoice) || base.authorized_invoice_id,
      stripe_subscription_id: null,
      payment_intent_id: stripeId(charge.payment_intent),
      charge_id: charge.id,
      status: charge.refunded ? 'succeeded' : 'partial',
      amount: integerOrNull(charge.amount_refunded),
      currency: normalizeCurrency(charge.currency),
      reason: null,
      full_adjustment: isFull
    },
    entitlement_status: isFull ? 'refunded' : null
  };
}

function normalizeCreditNote(base, creditNote) {
  const amount = integerOrNull(creditNote.total ?? creditNote.amount);
  const invoiceTotal = base.authorized_invoice_total;
  const status = base.event_type.endsWith('.voided') ? 'void' : creditNote.status || null;
  const isFull =
    status === 'issued' &&
    Number.isInteger(amount) &&
    Number.isInteger(invoiceTotal) &&
    invoiceTotal > 0 &&
    amount >= invoiceTotal;
  const customerId = stripeId(creditNote.customer) || base.authorized_customer_id;

  return {
    ...base,
    customer: customerId
      ? {
          stripe_customer_id: customerId,
          email: null,
          name: null,
          tier: base.authorized_offer_key,
          billing_status: isFull ? 'credited' : null,
          billing_country: null,
          manual_review_required: false,
          checkout_session_id: null,
          subscription_id: null,
          latest_invoice_id: stripeId(creditNote.invoice) || base.authorized_invoice_id,
          currency: normalizeCurrency(creditNote.currency),
          amount_paid: null,
          paid_at: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false
        }
      : null,
    adjustment: {
      adjustment_key: `credit_note:${creditNote.id}`,
      stripe_object_id: creditNote.id,
      object_type: 'credit_note',
      stripe_customer_id: stripeId(creditNote.customer) || base.authorized_customer_id,
      stripe_invoice_id: stripeId(creditNote.invoice) || base.authorized_invoice_id,
      stripe_subscription_id: null,
      payment_intent_id: null,
      charge_id: null,
      status,
      amount,
      currency: normalizeCurrency(creditNote.currency),
      reason: creditNote.reason || creditNote.memo || null,
      full_adjustment: isFull
    },
    // A full issued credit note removes the economic basis for access. Voiding
    // it never auto-restores access because another refund/dispute/cancellation
    // may still be active; a later verified paid lifecycle event may restore it.
    entitlement_status: isFull ? 'refunded' : null
  };
}

function normalizeDispute(base, dispute) {
  const customerId = stripeId(dispute.customer) || base.authorized_customer_id;
  const status = disputeStatus(base.event_type, dispute.status);
  const opened = OPEN_DISPUTE_STATUSES.has(status);
  const lost = status === 'lost';
  return {
    ...base,
    customer: customerId
      ? {
          stripe_customer_id: customerId,
          email: null,
          name: null,
          tier: base.authorized_offer_key,
          billing_status: opened ? 'disputed' : `dispute_${status}`,
          billing_country: null,
          manual_review_required: false,
          checkout_session_id: null,
          subscription_id: null,
          latest_invoice_id: null,
          currency: normalizeCurrency(dispute.currency),
          amount_paid: null,
          paid_at: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false
        }
      : null,
    adjustment: {
      adjustment_key: `dispute:${dispute.id}`,
      stripe_object_id: dispute.id,
      object_type: 'dispute',
      stripe_customer_id: customerId,
      stripe_invoice_id: base.authorized_invoice_id,
      stripe_subscription_id: null,
      payment_intent_id: stripeId(dispute.payment_intent),
      charge_id: stripeId(dispute.charge),
      status,
      amount: integerOrNull(dispute.amount),
      currency: normalizeCurrency(dispute.currency),
      reason: dispute.reason || null,
      full_adjustment: false
    },
    // `funds_reinstated` is a balance movement, not by itself permission to
    // restore product access. Open statuses suspend access; a lost dispute is
    // terminally revoked. Other terminal outcomes move to manual review (not
    // paid), while a later verified paid lifecycle event may restore access.
    entitlement_status: opened ? 'disputed' : lost ? 'dispute_lost' : 'manual_review'
  };
}

const OPEN_DISPUTE_STATUSES = new Set([
  'needs_response',
  'under_review',
  'warning_needs_response',
  'warning_under_review'
]);

function disputeStatus(eventType, value) {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (status) return status;
  if (eventType === 'charge.dispute.funds_reinstated') return 'funds_reinstated';
  if (eventType === 'charge.dispute.closed') return 'closed';
  // Missing status on an opening/update/withdrawal event must fail safe.
  return 'needs_response';
}

function invoicePeriod(invoice) {
  const lines = Array.isArray(invoice.lines?.data) ? invoice.lines.data : [];
  const starts = lines.map((line) => line.period?.start).filter(Number.isFinite);
  const ends = lines.map((line) => line.period?.end).filter(Number.isFinite);
  return {
    start: unixToIso(starts.length ? Math.min(...starts) : invoice.period_start),
    end: unixToIso(ends.length ? Math.max(...ends) : invoice.period_end)
  };
}

function linePriceId(line) {
  return (
    stripeId(line?.price) ||
    stripeId(line?.pricing?.price_details?.price) ||
    stripeId(line?.plan)
  );
}

function lineProductId(line) {
  return (
    stripeId(line?.price?.product) ||
    stripeId(line?.pricing?.price_details?.product) ||
    stripeId(line?.plan?.product)
  );
}

function tierFromMetadata(metadata) {
  const value =
    metadata?.offer_key ||
    metadata?.offer ||
    metadata?.product_key ||
    metadata?.tier ||
    metadata?.product_name ||
    null;
  if (!value) return null;
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80) || null;
}

function stripeId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function unixToIso(value) {
  if (!Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.includes('@') ? email : null;
}

function normalizeCurrency(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 3) : null;
}

function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function httpsUrlOrNull(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}
