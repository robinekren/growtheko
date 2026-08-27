import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CUSTOMER_LEVELS, applyCustomerLevels, resolveCustomerLevel } from './api/lib/customer-level.js';

test('customer level taxonomy matches the approved six-level revenue ladder', () => {
  assert.deepEqual(CUSTOMER_LEVELS.map(level => [level.emoji, level.label, level.amount]), [
    ['⏳', 'Lead', '$0'],
    ['😊', 'Entry', '$7'],
    ['💳', 'Member', '$97/mo'],
    ['💎', 'Premium', '$1,997'],
    ['💰', 'Growth', '$4,997'],
    ['🐋', 'Partner', '$14,997']
  ]);
});

test('a prescribed offer never upgrades an unpaid lead', () => {
  const level = resolveCustomerLevel({
    entity: { id: 'lead-1', entity_type: 'lead', email: 'lead@example.com', offer: { id: 'audit' } }
  });
  assert.equal(level.tag, '⏳ Lead');
  assert.equal(level.rank, 0);
});

test('the highest verified paid offer wins without duplicate manual tags', () => {
  const level = resolveCustomerLevel({
    entity: { id: 'customer-1', entity_type: 'customer', email: 'buyer@example.com' },
    entitlements: [
      { email: 'buyer@example.com', entitlement_key: 'membership', status: 'paid' },
      { email: 'buyer@example.com', entitlement_key: 'onetime_1997', status: 'paid' },
      { email: 'buyer@example.com', entitlement_key: 'done_with_you_4997', status: 'paid' }
    ]
  });
  assert.equal(level.tag, '💰 Growth');
  assert.equal(level.offer_id, 'sprint');
  assert.match(level.search_text, /4997/);
  assert.match(level.search_text, /AI System Sprint/);
});

test('canonical entitlement state overrides a stale paid customer mirror', () => {
  const level = resolveCustomerLevel({
    entity: {
      id: 'customer-2', entity_type: 'customer', email: 'refunded@example.com',
      offer: { id: 'audit' }, amount_paid: 1997, paid_at: '2026-08-27T10:00:00.000Z'
    },
    entitlements: [
      { email: 'refunded@example.com', entitlement_key: 'audit', status: 'refunded' }
    ]
  });
  assert.equal(level.tag, '⏳ Lead');
});

test('customer summaries and paid opportunities remain safe operational fallbacks', () => {
  const people = [{
    id: 'customer-entry', email: 'entry@example.com', offer: { id: 'digital_estate' }, amount_paid: 7
  }];
  const leads = [{ id: 'lead-premium', email: 'premium@example.com', offer: { id: 'audit' } }];
  const opportunities = [{
    id: 'opportunity-premium', entity_id: 'lead-premium', application_id: 'lead-premium',
    email: 'premium@example.com', offer: { id: 'audit' }, journey_stage: 'paid', paid_at: '2026-08-27T11:00:00.000Z'
  }];

  applyCustomerLevels(people, leads, opportunities, []);
  assert.equal(people[0].customer_level.tag, '😊 Entry');
  assert.equal(leads[0].customer_level.tag, '💎 Premium');
  assert.equal(opportunities[0].customer_level.tag, '💎 Premium');
});

test('Ops exposes customer tags in Customers, Pipeline and Inbox search', () => {
  const template = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
  assert.match(template, /item\.customer_level\?\.search_text/);
  assert.match(template, /thread\.customer_level=entity\?\.customer_level/);
  assert.match(template, /tag customer-level/);
  assert.match(template, /Customer level/);
});
