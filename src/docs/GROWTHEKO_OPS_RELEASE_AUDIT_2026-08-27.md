# GrowthEko OPS Release Audit — 2026-08-27

Status: production data foundation and application release completed.

- Production deployment: `dpl_4jYLsskeGHQzDUNssh9UpWaHM1wr`
- Production alias: `https://www.growtheko.com`
- Vercel status after deployment: Ready

## Recovery point

- Encrypted pre-migration export: `/Users/robinekren/Documents/Backups/GrowthEko/growtheko-supabase-20260827T172952Z.json.enc`
- Format: AES-256-CBC with PBKDF2, 200,000 iterations
- Decryption secret: macOS Keychain service `GrowthEko Supabase Backup 20260827T172952Z`, account `robinekren`
- SHA-256: `b663e8acaca283f56c63f23668f1613bbf8a21308be976dde17a24b205f142f2`
- Verification: decrypt and parse passed; 20 source tables and 505 rows were captured.

## Production data changes

Applied in the Supabase project `growtheko-customers`:

1. `20260827_nora_ops_audit_foundation.sql`
   - durable per-offer opportunities
   - append-only operational audit events
   - persistent decision history
   - service-role-only access with RLS enabled
   - conservative backfill; unknown legacy offers remain `legacy_review`
2. `20260827_stripe_billing_ledger.sql`
   - idempotent Stripe event inbox
   - customer, checkout, entitlement, subscription, invoice, adjustment and tax-ID mirrors
   - durable outbox and claim/apply/finish RPCs
   - worker remains inactive until the separate billing activation gates pass
3. `20260827_ops_multi_offer_opportunities.sql`
   - removes the one-application/one-opportunity limitation
   - preserves the unique source key for idempotency
   - permits $7, $97, $1,997, $4,997 and $14,997 opportunities for the same customer over time

## Verification evidence

- Backfill result: 26 opportunities, 119 audit events, 0 invented decisions.
- All 12 new OPS and billing tables report row-level security enabled.
- Billing smoke test ran inside a transaction and rolled back; all Stripe ledger counts remained zero.
- Opportunity index verification confirms a non-unique application index plus unique primary/source keys.
- Application contract suite: 46/46 tests passed.
- JavaScript syntax check and whitespace check passed.
- Desktop QA: one labelled localhost scenario, five-offer ladder, per-opportunity detail, two matched timeline events.
- Mobile QA at 390×844: 390 px document width, no horizontal overflow, bottom navigation fixed, blue amount tag visible, detail sheet contained within 10–380 px.

## Safety boundary

- No production record was deleted or overwritten during the migration/backfill.
- No ad, payment, invoice, email, WhatsApp message or customer-visible action was sent.
- `Approve & queue` records Robin's decision only. It does not perform the external action.
- A held or rejected task leaves the active queue; an approved task returns to Nora's queue with the stored approval attached.
