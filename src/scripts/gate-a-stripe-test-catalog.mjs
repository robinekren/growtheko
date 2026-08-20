import Stripe from 'stripe';
import { pathToFileURL } from 'node:url';

export const APPROVAL_SENTINEL = '2026-08-03';

export const CATALOG = Object.freeze([
  Object.freeze({
    offer: 'monthly_97',
    name: 'GrowthEko Operator Membership',
    description: 'Ongoing guidance, playbooks and templates. No done-for-you implementation.',
    currency: 'usd',
    unitAmount: 9700,
    recurring: Object.freeze({ interval: 'month', interval_count: 1 })
  }),
  Object.freeze({
    offer: 'onetime_1997',
    name: 'GrowthEko AI Operator Audit',
    description: 'One-time diagnosis and roadmap. Audit and recommendations only; no done-for-you build.',
    currency: 'usd',
    unitAmount: 199700,
    recurring: null
  })
]);

export function assertTestMutationGate(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!key.startsWith('sk_test_')) {
    throw new Error('A Stripe test-mode secret key is required; live keys are rejected.');
  }
  if (env.GROWTHEKO_GATE_A_PROVIDER_MUTATIONS_APPROVED !== APPROVAL_SENTINEL) {
    throw new Error(`Set GROWTHEKO_GATE_A_PROVIDER_MUTATIONS_APPROVED=${APPROVAL_SENTINEL} for the approved TEST-only batch.`);
  }
  const taxCode = String(env.GROWTHEKO_APPROVED_STRIPE_TAX_CODE || '').trim();
  if (!/^txcd_[A-Za-z0-9]+$/.test(taxCode)) {
    throw new Error('A professionally approved Stripe tax code is required; the script will not guess one.');
  }
  return { key, taxCode };
}

export function priceMatches(price, offer) {
  const cadenceMatches = offer.recurring
    ? price?.type === 'recurring' &&
      price?.recurring?.interval === offer.recurring.interval &&
      price?.recurring?.interval_count === offer.recurring.interval_count
    : price?.type === 'one_time' && !price?.recurring;
  return Boolean(
    price?.active === true &&
    price?.currency === offer.currency &&
    price?.unit_amount === offer.unitAmount &&
    price?.tax_behavior === 'exclusive' &&
    price?.metadata?.growtheko_offer === offer.offer &&
    cadenceMatches
  );
}

export function publicManifest() {
  return CATALOG.map((offer) => ({
    offer: offer.offer,
    name: offer.name,
    currency: offer.currency,
    unitAmount: offer.unitAmount,
    taxBehavior: 'exclusive',
    cadence: offer.recurring || 'one_time'
  }));
}

async function findOrCreateProduct(stripe, offer, taxCode) {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const matching = products.data.filter((item) => item.metadata?.growtheko_offer === offer.offer);
  if (matching.length > 1) throw new Error(`Multiple active products claim ${offer.offer}. Resolve manually.`);
  if (matching.length === 1) {
    const product = matching[0];
    if (product.name !== offer.name || product.tax_code !== taxCode) {
      throw new Error(`Existing ${offer.offer} product conflicts with the approved name or tax code.`);
    }
    return { product, created: false };
  }
  const product = await stripe.products.create({
    name: offer.name,
    description: offer.description,
    tax_code: taxCode,
    metadata: { growtheko_offer: offer.offer, gate: 'A', environment: 'test' }
  }, { idempotencyKey: `growtheko-gate-a-product-${offer.offer}-v1` });
  return { product, created: true };
}

async function findOrCreatePrice(stripe, offer, productId) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const exact = prices.data.filter((price) => priceMatches(price, offer));
  if (exact.length > 1) throw new Error(`Multiple active exact prices exist for ${offer.offer}. Resolve manually.`);
  if (exact.length === 1) return { price: exact[0], created: false };
  if (prices.data.length > 0) {
    throw new Error(`An active but conflicting price exists for ${offer.offer}. No new price was created.`);
  }
  const params = {
    product: productId,
    currency: offer.currency,
    unit_amount: offer.unitAmount,
    tax_behavior: 'exclusive',
    metadata: { growtheko_offer: offer.offer, gate: 'A', environment: 'test' }
  };
  if (offer.recurring) params.recurring = offer.recurring;
  const price = await stripe.prices.create(
    params,
    { idempotencyKey: `growtheko-gate-a-price-${offer.offer}-v1` }
  );
  return { price, created: true };
}

export async function applyTestCatalog(env = process.env) {
  const { key, taxCode } = assertTestMutationGate(env);
  const stripe = new Stripe(key);
  const account = await stripe.accounts.retrieve();
  if (account.country !== 'AT') throw new Error(`Expected Austrian Stripe account; got ${account.country || 'unknown'}.`);
  const output = [];
  for (const offer of CATALOG) {
    const productResult = await findOrCreateProduct(stripe, offer, taxCode);
    const priceResult = await findOrCreatePrice(stripe, offer, productResult.product.id);
    if (priceResult.price.livemode !== false) throw new Error('Unexpected live-mode Price returned.');
    output.push({
      offer: offer.offer,
      productId: productResult.product.id,
      priceId: priceResult.price.id,
      productCreated: productResult.created,
      priceCreated: priceResult.created
    });
  }
  return { accountId: account.id, country: account.country, mode: 'test', offers: output };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', catalog: publicManifest() }, null, 2)}\n`);
    return;
  }
  const result = await applyTestCatalog();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Gate-A Stripe TEST catalog stopped: ${error.message}\n`);
    process.exitCode = 1;
  });
}
