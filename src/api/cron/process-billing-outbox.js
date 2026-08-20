// Durable GrowthEko billing side effects.
// Stripe remains the only customer invoice source; this worker never creates
// or sends a second invoice.

import { createHash, timingSafeEqual } from 'node:crypto';

import { processBillingOutboxBatch } from '../_billing-outbox-worker.js';
import { GROWTHEKO_NOTIFY_EMAIL, sender } from '../_mail-config.js';
import { SupabaseBillingRepository } from '../_supabase-billing-repository.js';
import { appendOnboardingToken, createOnboardingToken } from '../lib/onboarding-token.js';

const INTERNAL_ACTIONS = new Set([
  'invoice_paid',
  'payment_failed',
  'subscription_canceled',
  'billing_adjustment',
  'manual_billing_review'
]);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.GROWTHEKO_BILLING_WORKER_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Billing worker is disabled' });
  }

  const cronSecret = process.env.CRON_SECRET || '';
  const authorization = header(req, 'authorization');
  if (!cronSecret || !secureEqual(authorization, `Bearer ${cronSecret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.GROWTHEKO_SUPABASE_URL;
  const supabaseServiceKey = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!supabaseUrl || !supabaseServiceKey || !resendApiKey) {
    console.error('[BILLING OUTBOX] Worker infrastructure is not fully configured');
    return res.status(500).json({ error: 'Billing worker is not configured' });
  }

  const repository = new SupabaseBillingRepository({
    url: supabaseUrl,
    serviceKey: supabaseServiceKey
  });
  const batchSize = boundedBatchSize(process.env.GROWTHEKO_BILLING_WORKER_BATCH_SIZE);

  try {
    const summary = await processBillingOutboxBatch({
      repository,
      batchSize,
      deliverJob: (job) => deliverBillingJob(job, { resendApiKey })
    });
    return res.status(summary.failed > 0 ? 207 : 200).json(summary);
  } catch (error) {
    console.error(`[BILLING OUTBOX] Worker failed: ${safeLogMessage(error)}`);
    return res.status(500).json({ error: 'Billing worker failed' });
  }
}

export async function deliverBillingJob(job, {
  resendApiKey,
  fetchImpl = fetch,
  senderFactory = sender,
  notifyEmail = GROWTHEKO_NOTIFY_EMAIL,
  onboardingTokenSecret = process.env.BILLING_ONBOARDING_TOKEN_SECRET
}) {
  const payload = isRecord(job?.payload) ? job.payload : {};
  const actionType = String(job?.action_type || '');

  if (actionType === 'customer_onboarding') {
    const email = validEmail(payload.email);
    const baseOnboardingUrl = validOnboardingUrl(payload.onboarding_url);
    const stripeCustomerId = validStripeCustomerId(payload.stripe_customer_id);
    if (!email || !baseOnboardingUrl || !stripeCustomerId) {
      throw new Error('Onboarding job is missing a valid customer email or URL');
    }

    const onboardingToken = createOnboardingToken({
      email,
      tier: payload.tier,
      stripeCustomerId
    }, onboardingTokenSecret);
    const onboardingUrl = appendOnboardingToken(baseOnboardingUrl, onboardingToken);

    const firstName = firstNameFrom(payload.name);
    const tier = String(payload.tier || 'GrowthEko').slice(0, 80);
    const result = await sendResendEmail({
      apiKey: resendApiKey,
      fetchImpl,
      from: senderFactory('GrowthEko'),
      to: email,
      idempotencyKey: job.dedupe_key,
      subject: 'Your GrowthEko access is ready',
      html: customerOnboardingHtml({ firstName, tier, onboardingUrl })
    });
    return { provider: 'resend', message_id: result.id || null, action_type: actionType };
  }

  if (!INTERNAL_ACTIONS.has(actionType)) {
    throw new Error(`Unsupported billing outbox action: ${actionType || 'missing'}`);
  }

  const notice = internalNotice(actionType, payload);
  const result = await sendResendEmail({
    apiKey: resendApiKey,
    fetchImpl,
    from: senderFactory('GrowthEko Billing'),
    to: notifyEmail,
    idempotencyKey: job.dedupe_key,
    subject: notice.subject,
    html: notice.html
  });
  return { provider: 'resend', message_id: result.id || null, action_type: actionType };
}

async function sendResendEmail({ apiKey, fetchImpl, from, to, idempotencyKey, subject, html }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response;

  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Resend request timed out');
    throw new Error('Resend request failed', { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend rejected billing email (${response.status})`);
  }

  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Resend returned invalid JSON');
  }
}

function internalNotice(actionType, payload) {
  const customer = isRecord(payload.customer) ? payload.customer : {};
  const invoice = isRecord(payload.invoice) ? payload.invoice : {};
  const adjustment = isRecord(payload.adjustment) ? payload.adjustment : {};
  const email = customer.email || payload.email || 'unknown customer';
  const invoiceId = invoice.stripe_invoice_id || customer.latest_invoice_id || '—';
  const subscriptionId =
    payload.subscription?.stripe_subscription_id || customer.subscription_id || '—';
  const amount = money(invoice.amount_paid ?? invoice.amount_due ?? adjustment.amount, invoice.currency || adjustment.currency);
  const country = customer.billing_country || payload.billing_country || 'missing';

  const labels = {
    invoice_paid: ['Paid Stripe invoice', 'Stripe is the customer invoice source; no second invoice was generated.'],
    payment_failed: ['Payment failed', 'Stripe retry/dunning state requires attention.'],
    subscription_canceled: ['Subscription canceled', 'Customer access was moved to the canceled/paused state.'],
    billing_adjustment: ['Refund / credit note / dispute update', 'Review the Stripe adjustment and the accounting follow-up.'],
    manual_billing_review: ['Manual billing review required', 'Automatic fulfillment is held because billing-country evidence is outside Austria or missing.']
  };
  const [title, explanation] = labels[actionType];

  return {
    subject: `[BILLING] ${title} — ${String(email).slice(0, 120)}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#111;line-height:1.55">
        <h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
        <p style="margin:0 0 20px;color:#555">${escapeHtml(explanation)}</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          ${row('Action', actionType)}
          ${row('Customer', email)}
          ${row('Amount', amount)}
          ${row('Billing country', country)}
          ${row('Stripe invoice', invoiceId)}
          ${row('Stripe subscription', subscriptionId)}
        </table>
      </div>`
  };
}

function customerOnboardingHtml({ firstName, tier, onboardingUrl }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111;line-height:1.6">
      <p style="font-size:13px;letter-spacing:.08em;color:#666">GROWTHEKO</p>
      <h1 style="font-size:26px;margin:18px 0 12px">Welcome, ${escapeHtml(firstName)}.</h1>
      <p>Your payment is confirmed and your <strong>${escapeHtml(tier)}</strong> onboarding is ready.</p>
      <p style="margin:28px 0">
        <a href="${escapeHtml(onboardingUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:600">Start onboarding</a>
      </p>
      <p style="font-size:13px;color:#777">This message grants onboarding access. Your Stripe invoice is delivered separately by Stripe.</p>
    </div>`;
}

function row(label, value) {
  return `<tr><td style="padding:8px;border-top:1px solid #eee;color:#777">${escapeHtml(label)}</td><td style="padding:8px;border-top:1px solid #eee">${escapeHtml(value)}</td></tr>`;
}

function validEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validOnboardingUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'growtheko.com' && url.pathname === '/onboard'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function validStripeCustomerId(value) {
  const id = String(value || '').trim();
  return /^cus_[A-Za-z0-9]+$/.test(id) ? id : null;
}

function firstNameFrom(value) {
  const firstName = typeof value === 'string' ? value.trim().split(/\s+/, 1)[0] : '';
  return firstName.slice(0, 80) || 'there';
}

function money(cents, currency) {
  if (!Number.isInteger(cents)) return '—';
  const code = typeof currency === 'string' ? currency.toUpperCase() : 'USD';
  return `${code} ${(cents / 100).toFixed(2)}`;
}

function boundedBatchSize(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(20, Math.max(1, parsed)) : 10;
}

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || '');
}

function secureEqual(actual, expected) {
  const actualDigest = createHash('sha256').update(String(actual)).digest();
  const expectedDigest = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function escapeHtml(value) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeLogMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}
