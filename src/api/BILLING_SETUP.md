# GrowthEko billing endpoints

This directory contains the server-side checkout boundary for the two approved offers:

- `monthly_97`: USD 97 net, recurring monthly
- `onetime_1997`: USD 1,997 net, one-time

No client-supplied Stripe Price ID is accepted. Both Price IDs are resolved exclusively from server environment variables.

## Required Stripe configuration

Create or verify two active Stripe Prices:

1. `STRIPE_PRICE_MONTHLY_97`: USD 97.00, recurring every month, `tax_behavior=exclusive`
2. `STRIPE_PRICE_ONETIME_1997`: USD 1,997.00, one-time, `tax_behavior=exclusive`

The endpoint retrieves every configured Price and fails closed if amount, currency, cadence, active state, or tax behavior differs from the contract.

The local catalog preparation command is `npm run gate-a:stripe:dry-run`. The mutation command
`npm run gate-a:stripe:apply-test` rejects live keys, refuses to run without the dated TEST-provider
approval sentinel and requires an adviser-approved Stripe tax code. It reuses exact matching TEST
objects, fails on conflicts and never guesses a tax classification. Do not run the mutation command
until the correct Austrian Stripe test-mode credential and approved tax code are available.

Configure the environment keys listed in `.env.example`. In particular:

- `GROWTHEKO_STRIPE_EVENT_MODE` must be exactly `test` or `live` and must match the Stripe webhook events received by this deployment.
- `BILLING_PORTAL_COOKIE_SECRET` and `BILLING_ONBOARDING_TOKEN_SECRET` must be separate random values of at least 32 bytes.
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` must be the reviewed, restricted Stripe Billing Portal configuration (`bpc_...`). Production portal creation fails closed without it.
- `BILLING_BASE_URL` must be a bare HTTPS origin; production is `https://www.growtheko.com`.
- `GROWTHEKO_SUPABASE_URL` plus `GROWTHEKO_SUPABASE_SERVICE_KEY` (or the documented server-only aliases) are required for durable state. Never expose the service-role key to a browser bundle.

`GROWTHEKO_BILLING_LIVE_ENABLED` is the hard launch gate. Checkout Session creation is disabled with the stable `billing_not_live` error unless its value is exactly `true`. Keep it unset until every production gate below is complete.

### Invoice branding asset

The canonical GrowthEko invoice mark is prepared locally at `04-infra/brand/growtheko/documents/growtheko-mark-invoice-transparent-600.png`; use the white-canvas fallback from the same folder only where alpha is unsupported. Stripe remains the sole legal customer-invoice issuer, so the mark belongs in Stripe's reviewed invoice/branding configuration—not in a new local or sevdesk invoice generator.

Applying the mark in Stripe is an external settings change and requires Robin's separate explicit approval. After approval, confirm the mark on a Stripe TEST invoice, receipt, credit note and customer portal at normal PDF size before live mode. No Stripe or sevdesk setting was changed during the 2026-07-14 local brand integration.

## Checkout request

`POST /api/create-checkout` with `Content-Type: application/json`:

```json
{
  "offer": "monthly_97",
  "requestId": "a-new-unique-id-per-checkout-attempt",
  "email": "buyer@example.com",
  "companyName": "Example GmbH",
  "buyerCountry": "AT",
  "acceptsB2B": true,
  "acceptsTerms": true,
  "acceptsElectronicInvoices": true,
  "termsVersion": "2026-07-10",
  "acceptedAt": "2026-07-10T12:00:00.000Z"
}
```

`acceptedAt` must be generated at the actual confirmation click and may be no more than 15 minutes old. The server rejects missing, stale or incomplete B2B/Terms/e-invoice evidence and persists the accepted version through the Stripe metadata and webhook state.

The successful response is:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

The frontend must navigate to `checkoutUrl`. This is hosted Stripe Checkout, not embedded Checkout. A repeated request must reuse the same `requestId`; a new purchase attempt must use a new ID.

The endpoint creates a new isolated Stripe Customer for every unauthenticated checkout so an email address can never select another customer's portal identity. The submitted company name and email become invoice master data; Checkout collects the billing address and tax ID. Stripe automatic tax is enabled. The one-time offer enables Stripe invoice creation; subscriptions create recurring Stripe invoices through Billing.

## Austria-only phase-one gate

Only `buyerCountry=AT` is accepted. Other countries return HTTP 422 with `manualReview=true`. The payment webhook independently checks Stripe's invoice/Checkout billing country. A paid invoice with a missing or non-AT country is stored but held in `manual_review`; it does not grant onboarding access and creates a `manual_billing_review` outbox action.

## Webhook and durable side effects

Run `supabase/migrations/20260710_autonomous_billing_state.sql` once in the GrowthEko Supabase project before registering `/api/webhook` in Stripe. The webhook requires `STRIPE_WEBHOOK_SECRET`, verifies the untouched raw request body, and stores every Stripe event insert-first by `event.id`.

Handled events include Checkout completion, paid/failed invoices, subscription updates/pauses/resumes/deletions, the full tax-ID create/update/delete lifecycle, refunds, credit notes, and disputes. Checkout completion never grants durable access. Only `invoice.paid` can grant the `paid` entitlement; a resume event alone cannot. Later payment failure, cancellation, full refund/full issued credit note, or dispute transitions suspend or revoke it. An open dispute blocks later renewal events from reopening access; a terminal dispute remains in manual review until a later valid payment. Per-object event timestamps and event priorities prevent older deliveries from regressing newer state.

Access is stored per approved offer in `stripe_billing_entitlements`. Customer-level summary fields are operational mirrors only and must never be the authorization source. Onboarding links are signed, bind offer plus Stripe Customer without exposing the email address, and are delivered only through the durable outbox after a valid first `invoice.paid` event.

Database state changes enqueue deduplicated actions in `stripe_billing_outbox`. `/api/cron/process-billing-outbox` atomically claims a bounded batch, sends through Resend, and records completion or exponential-backoff retry. `vercel.json` schedules this worker every five minutes and gives it a 60-second function budget. Vercel supplies `Authorization: Bearer $CRON_SECRET` to production cron invocations; the endpoint rejects calls without the matching bearer token. Set `GROWTHEKO_BILLING_WORKER_ENABLED=true` only after test-mode QA. `GROWTHEKO_BILLING_WORKER_BATCH_SIZE` defaults to 10 and is capped at 20.

The worker sends the onboarding link to a first-time paid customer and internal operational notices for paid invoices, failures, cancellations, adjustments, and manual review. It never creates or emails a second invoice: Stripe remains the customer invoice source. A scheduler must invoke the worker endpoint frequently enough for the desired onboarding SLA; do not turn on the worker gate until that authenticated schedule exists.

## Billing portal authentication

`POST /api/create-billing-portal` accepts only:

```json
{
  "checkoutSessionId": "cs_..."
}
```

The endpoint additionally requires a secure, HttpOnly, host-only cookie created during the matching checkout request. The cookie token is tied to the checkout request, its hash is stored in Stripe Checkout Session metadata, and access is granted only after a completed, paid Session maps to a Stripe Customer. Email addresses and raw customer IDs are never accepted as authentication. Production also pins the reviewed `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`; dashboard default changes cannot silently expand the allowed portal actions.

There is no full GrowthEko customer-login identity layer in this source. Therefore the portal deliberately fails closed when the cookie is missing, expired, belongs to another checkout, or the customer uses another device. The temporary cookie lasts 30 days. Before calling this a permanent self-service portal, replace or supplement it with real authenticated-user-to-Stripe-Customer mapping.

## Remaining production gates

- Apply the canonical GrowthEko mark to the reviewed Stripe TEST branding/invoice configuration under explicit approval; verify invoice, receipt, credit-note and portal rendering before live mode.
- Configure and test Stripe invoice emails and invoice master data.
- Match the Stripe webhook endpoint API version to the tested Stripe SDK schema and subscribe to every event listed above.
- Apply the migration only after a Supabase backup, duplicate-customer preflight, `service_role.BYPASSRLS` verification and confirmation that no legitimate browser feature depends on the removed direct table policies.
- Connect exactly one invoice source to sevdesk; do not let Stripe and sevdesk independently issue duplicate customer invoices.
- Verify that the production Vercel Pro project recognizes the five-minute authenticated schedule for `/api/cron/process-billing-outbox`, then verify retry/dead-letter monitoring.
- Run test-mode checkout, renewal, failure, cancellation, refund, invoice, email, tax, and duplicate-event QA before live mode.

## Local tests

No package installation is required:

```sh
npm test
npm run check
```

For database-level claim, duplicate, retry, and ordering checks, apply the migration to an isolated PostgreSQL database and then run `test/billing-state.integration.sql`.
