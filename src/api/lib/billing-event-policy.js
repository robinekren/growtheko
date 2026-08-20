const HANDLED_TYPES = new Set([
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

export class BillingScopeError extends Error {
  constructor(message = 'Stripe event is outside the GrowthEko billing scope') {
    super(message);
    this.name = 'BillingScopeError';
    this.code = 'BILLING_SCOPE_REJECTED';
  }
}

export class BillingPolicySetupError extends Error {
  constructor(message = 'Stripe billing event policy is not configured') {
    super(message);
    this.name = 'BillingPolicySetupError';
    this.code = 'BILLING_POLICY_NOT_CONFIGURED';
  }
}

export async function authorizeGrowthEkoBillingEvent(event, { stripe, env = process.env }) {
  if (!HANDLED_TYPES.has(String(event?.type || ''))) return event;

  const catalog = catalogFromEnv(env);
  const expectedLivemode = expectedLivemodeFromEnv(env);
  if (Boolean(event.livemode) !== expectedLivemode) {
    throw new BillingScopeError('Stripe event mode does not match the configured billing mode');
  }

  const object = event?.data?.object;
  if (!object || typeof object !== 'object') throw new BillingScopeError('Stripe object is missing');
  let authorizedOffer;
  let authorizedCustomerId = stripeId(object.customer);
  let authorizedInvoiceId = stripeId(object.invoice);
  let authorizedInvoiceTotal = null;

  if (event.type === 'checkout.session.completed') {
    const offer = offerFromMetadata(object.metadata, catalog);
    authorizedOffer = offer;
    assertCurrency(object.currency);
    assertIntegerEquals(object.amount_subtotal, offer.unitAmount, 'Checkout subtotal');
    if (object.mode !== offer.mode) throw new BillingScopeError('Checkout mode does not match the offer');
    const lineItems = await stripe.checkout.sessions.listLineItems(object.id, { limit: 10 });
    assertApprovedLines(lineItems?.data, offer);
  } else if (event.type.startsWith('invoice.')) {
    authorizedOffer = assertApprovedInvoice(object, catalog);
    authorizedCustomerId = stripeId(object.customer);
    authorizedInvoiceId = stripeId(object);
    authorizedInvoiceTotal = integerOrNull(object.total);
  } else if (event.type.startsWith('customer.subscription.')) {
    const offer = offerFromMetadata(object.metadata, catalog);
    authorizedOffer = offer;
    authorizedCustomerId = stripeId(object.customer);
    if (offer.mode !== 'subscription') throw new BillingScopeError('Subscription event uses a non-subscription offer');
    assertApprovedSubscription(object, offer);
  } else if (event.type.startsWith('customer.tax_id.')) {
    const customerId = stripeId(object.customer);
    if (!customerId) throw new BillingScopeError('Tax ID event is missing its customer');
    const customer = await stripe.customers.retrieve(customerId);
    authorizedOffer = offerFromMetadata(customer?.metadata, catalog);
    authorizedCustomerId = customerId;
  } else {
    const invoice = await resolveAdjustmentInvoice(event, stripe);
    authorizedOffer = assertApprovedInvoice(invoice, catalog);
    authorizedCustomerId = stripeId(invoice.customer);
    authorizedInvoiceId = stripeId(invoice);
    authorizedInvoiceTotal = integerOrNull(invoice.total);
  }

  if (!authorizedOffer || !authorizedCustomerId) {
    throw new BillingScopeError('Stripe event is missing its authorized offer or customer');
  }

  return {
    ...event,
    growtheko_scope_validated: true,
    growtheko_offer_key: authorizedOffer.key,
    growtheko_customer_id: authorizedCustomerId,
    growtheko_invoice_id: authorizedInvoiceId || null,
    growtheko_invoice_total: authorizedInvoiceTotal
  };
}

function catalogFromEnv(env) {
  const monthlyPrice = String(env.STRIPE_PRICE_MONTHLY_97 || '').trim();
  const oneTimePrice = String(env.STRIPE_PRICE_ONETIME_1997 || '').trim();
  if (!validPriceId(monthlyPrice) || !validPriceId(oneTimePrice) || monthlyPrice === oneTimePrice) {
    throw new BillingPolicySetupError('Approved Stripe Price IDs are missing or invalid');
  }

  return {
    monthly_97: {
      key: 'monthly_97',
      priceId: monthlyPrice,
      unitAmount: 9700,
      mode: 'subscription'
    },
    onetime_1997: {
      key: 'onetime_1997',
      priceId: oneTimePrice,
      unitAmount: 199700,
      mode: 'payment'
    }
  };
}

function expectedLivemodeFromEnv(env) {
  const mode = String(env.GROWTHEKO_STRIPE_EVENT_MODE || '').trim().toLowerCase();
  if (mode === 'test') return false;
  if (mode === 'live') return true;
  throw new BillingPolicySetupError('GROWTHEKO_STRIPE_EVENT_MODE must be test or live');
}

function offerFromMetadata(metadata, catalog) {
  if (metadata?.billing_scope !== 'at_b2b_phase_1') {
    throw new BillingScopeError('Stripe object is missing the GrowthEko billing scope');
  }
  const key = String(metadata.offer || metadata.offer_key || '').trim();
  const offer = catalog[key];
  if (!offer) throw new BillingScopeError('Stripe object uses an unapproved offer');
  if (
    metadata.terms_version !== '2026-07-10' ||
    metadata.b2b_attested !== 'true' ||
    metadata.electronic_invoice_consented !== 'true' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(String(metadata.terms_accepted_at || ''))
  ) {
    throw new BillingScopeError('Stripe object is missing required B2B/Terms/invoice consent evidence');
  }
  return offer;
}

function invoiceMetadata(invoice) {
  const firstLine = invoice?.lines?.data?.[0];
  return {
    ...(invoice?.subscription_details?.metadata || {}),
    ...(invoice?.parent?.subscription_details?.metadata || {}),
    ...(firstLine?.metadata || {}),
    ...(invoice?.metadata || {})
  };
}

function assertApprovedInvoice(invoice, catalog) {
  if (!invoice || typeof invoice !== 'object') throw new BillingScopeError('Related Stripe invoice is missing');
  const offer = offerFromMetadata(invoiceMetadata(invoice), catalog);
  assertCurrency(invoice.currency);
  assertIntegerEquals(invoice.subtotal, offer.unitAmount, 'Invoice subtotal');
  assertApprovedLines(invoice.lines?.data, offer);
  return offer;
}

function assertApprovedSubscription(subscription, offer) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || items.length !== 1) {
    throw new BillingScopeError('Subscription must contain exactly one approved item');
  }
  const price = items[0]?.price || items[0]?.plan;
  if (stripeId(price) !== offer.priceId) throw new BillingScopeError('Subscription Price is not approved');
  assertCurrency(price?.currency || subscription.currency);
  assertIntegerEquals(price?.unit_amount, offer.unitAmount, 'Subscription unit amount');
}

function assertApprovedLines(lines, offer) {
  if (!Array.isArray(lines) || lines.length !== 1) {
    throw new BillingScopeError('Billing object must contain exactly one approved line');
  }
  const line = lines[0];
  const priceId =
    stripeId(line?.price) ||
    stripeId(line?.pricing?.price_details?.price) ||
    stripeId(line?.plan);
  if (priceId !== offer.priceId) throw new BillingScopeError('Billing line Price is not approved');
}

async function resolveAdjustmentInvoice(event, stripe) {
  const object = event.data.object;
  let invoiceId = stripeId(object.invoice);

  if (!invoiceId && event.type.startsWith('credit_note.')) {
    invoiceId = stripeId(object.invoice);
  }

  if (!invoiceId) {
    let charge = object;
    if (!event.type.startsWith('charge.')) {
      const chargeId = stripeId(object.charge);
      if (!chargeId) throw new BillingScopeError('Adjustment is missing its related charge');
      charge = await stripe.charges.retrieve(chargeId);
    } else if (event.type.startsWith('charge.dispute.')) {
      const chargeId = stripeId(object.charge);
      if (!chargeId) throw new BillingScopeError('Dispute is missing its related charge');
      charge = await stripe.charges.retrieve(chargeId);
    }
    invoiceId = stripeId(charge?.invoice);
  }

  if (!invoiceId) throw new BillingScopeError('Adjustment is not linked to a Stripe invoice');
  return stripe.invoices.retrieve(invoiceId);
}

function assertCurrency(value) {
  if (String(value || '').toLowerCase() !== 'usd') {
    throw new BillingScopeError('Billing currency is not USD');
  }
}

function assertIntegerEquals(actual, expected, label) {
  if (!Number.isInteger(actual) || actual !== expected) {
    throw new BillingScopeError(`${label} does not match the approved offer`);
  }
}

function stripeId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function validPriceId(value) {
  return /^price_[A-Za-z0-9]+$/.test(value);
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}
