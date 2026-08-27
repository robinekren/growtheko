import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { canonicalDecisionKey } from './api/ops-decision.js';

test('OPS audit foundation is append-only, private and source-linked', () => {
  const migration = readFileSync(new URL('./supabase/migrations/20260827_nora_ops_audit_foundation.sql', import.meta.url), 'utf8');
  assert.match(migration, /create table if not exists public\.opportunities/);
  assert.match(migration, /create table if not exists public\.ops_audit_events/);
  assert.match(migration, /create table if not exists public\.ops_decisions/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /growtheko_prevent_audit_mutation/);
  assert.match(migration, /ops_audit_events is append-only/);
  assert.doesNotMatch(migration, /delete from public\.(applications|customers|messages)/i);
});

test('one application can hold multiple offer opportunities', () => {
  const migration = readFileSync(new URL('./supabase/migrations/20260827_ops_multi_offer_opportunities.sql', import.meta.url), 'utf8');
  assert.match(migration, /drop index if exists public\.opportunities_application_unique/);
  assert.match(migration, /create index if not exists opportunities_application_idx/);
  assert.doesNotMatch(migration, /create unique index/i);
});

test('billing ledger remains private, durable and outbox-driven', () => {
  const migration = readFileSync(new URL('./supabase/migrations/20260827_stripe_billing_ledger.sql', import.meta.url), 'utf8');
  assert.match(migration, /create table if not exists public\.stripe_webhook_events/);
  assert.match(migration, /create table if not exists public\.stripe_billing_outbox/);
  assert.match(migration, /claim_stripe_webhook_event/);
  assert.match(migration, /apply_stripe_billing_event/);
  assert.match(migration, /enable row level security/);
});

test('decision IDs are deterministic without exposing task content', () => {
  const first = canonicalDecisionKey('lead:123:offer:approval');
  assert.equal(first, canonicalDecisionKey('lead:123:offer:approval'));
  assert.match(first, /^ops:[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /lead|offer|approval/);
});
