import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BILLING_TERMS_VERSION,
  COMMERCIAL_ACTIVATION,
  ECOSYSTEM_ENTRY_REGISTRY,
  OFFER_REGISTRY,
  OFFER_REGISTRY_VERSION,
  QUARANTINED_OFFER_KEYS,
  resolveEcosystemEntryKey,
  resolveOfferKey
} from './api/lib/offer-registry.js';
import { canonicalOffer } from './api/crm-data.js';
import { normalizeBillingTier } from './api/onboard.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('registry locks exactly one free entry and four paid containers', () => {
  assert.equal(OFFER_REGISTRY_VERSION, '2026-08-23.3');
  assert.deepEqual(Object.keys(OFFER_REGISTRY), ['starter', 'membership', 'audit', 'sprint', 'architect']);
  assert.deepEqual(Object.values(OFFER_REGISTRY).map(({ name }) => name), [
    'GrowthEko Operator Starter',
    'GrowthEko Operator Membership',
    'GrowthEko AI Operator Audit',
    'GrowthEko AI System Sprint',
    'GrowthEko AI Empire Architect'
  ]);
  assert.deepEqual(Object.values(OFFER_REGISTRY).map(({ price }) => price), [
    '$0', '$97 USD', '$1,997 USD', '$4,997 USD', '$14,997 USD'
  ]);
});

test('Digital Estate $7 offer is recorded without becoming a GrowthEko container', () => {
  const entry = ECOSYSTEM_ENTRY_REGISTRY.digital_estate;

  assert.deepEqual(Object.keys(ECOSYSTEM_ENTRY_REGISTRY), ['digital_estate']);
  assert.equal(entry.name, 'AI Digital Estate Launch System');
  assert.equal(entry.brand, 'RobinEkren');
  assert.equal(entry.normalPrice, '$97 USD');
  assert.equal(entry.normalPriceDisplay, 'crossed_out');
  assert.equal(entry.currentPrice, '$7 USD');
  assert.equal(entry.status, 'active_offer');
  assert.equal(entry.growthEkoContainer, false);
  assert.equal(entry.revenueAttribution, 'robinekren_digital_estate');
  assert.equal(entry.route, 'https://www.robinekren.com/digital-estate');
  assert.equal(entry.termsRoute, 'https://www.robinekren.com/digital-estate-terms');
  assert.equal(resolveEcosystemEntryKey('digital_estate_founder_7').entryId, 'digital_estate');
  assert.equal(resolveEcosystemEntryKey('digital_estate_standard_97').entryId, 'digital_estate');
  assert.equal(resolveOfferKey('digital_estate').offerId, null);
});

test('paid activation remains zero while capacity ceilings stay conditional', () => {
  assert.equal(COMMERCIAL_ACTIVATION.paidActivationCapacity, 0);
  assert.equal(OFFER_REGISTRY.membership.status, 'blocked_gate_a');
  assert.equal(OFFER_REGISTRY.audit.status, 'blocked_gate_a');
  assert.equal(OFFER_REGISTRY.sprint.status, 'application_only_blocked_gate_b');
  assert.equal(OFFER_REGISTRY.architect.status, 'application_only_blocked_gate_c');
  assert.match(OFFER_REGISTRY.membership.conditionalCapacity, /100 active paid/);
  assert.match(OFFER_REGISTRY.audit.conditionalCapacity, /2 active.*4 starts/);
  assert.match(OFFER_REGISTRY.sprint.conditionalCapacity, /2 active.*2 starts/);
  assert.match(OFFER_REGISTRY.architect.conditionalCapacity, /2 active.*1 start/);
});

test('current identifiers resolve and every quarantined identifier fails closed', () => {
  for (const [key, id] of [
    ['monthly_97', 'membership'], ['onetime_1997', 'audit'], ['roadmap_1997', 'audit'],
    ['done_with_you_4997', 'sprint'], ['done_for_you_14997', 'architect']
  ]) {
    assert.equal(resolveOfferKey(key).offerId, id);
    assert.equal(normalizeBillingTier(key), id);
    assert.equal(canonicalOffer(key).review_required, false);
  }

  for (const key of QUARANTINED_OFFER_KEYS) {
    assert.equal(resolveOfferKey(key).offerId, null);
    assert.equal(normalizeBillingTier(key), 'legacy_review');
    assert.equal(canonicalOffer(key).review_required, true);
  }
});

test('public surfaces use canonical routes and current Terms evidence', () => {
  const start = read('./start/index.html');
  const offer = read('./offer/index.html');
  const apply = read('./apply/index.html');
  const terms = read('./terms/index.html');
  const billingPolicy = read('./api/lib/billing-event-policy.js');

  assert.equal(BILLING_TERMS_VERSION, '2026-08-28-v1.3');
  assert.match(start, /termsVersion: '2026-08-28-v1\.3'/);
  assert.match(terms, /Effective date: 28 August 2026 · Version 1\.3/);
  assert.match(billingPolicy, /metadata\.terms_version !== BILLING_TERMS_VERSION/);
  assert.match(offer, /href:'\/calculator'/);
  assert.match(offer, /href:'\/start\?checkout=monthly_97'/);
  assert.match(offer, /href:'\/start\?checkout=onetime_1997'/);
  assert.match(offer, /href:'\/apply\?offer=done_with_you_4997'/);
  assert.match(offer, /href:'\/apply\?offer=done_for_you_14997'/);
  assert.match(apply, /window\.location\.replace\('\/start\?checkout=monthly_97'\)/);
  assert.match(apply, /window\.location\.replace\('\/start\?checkout=onetime_1997'\)/);
  assert.match(start, /AI Digital Estate Launch System/);
  assert.match(start, /<s>\$97 USD<\/s> <strong>\$7 USD<\/strong> <small>one time<\/small>/);
  assert.match(start, /href="https:\/\/www\.robinekren\.com\/digital-estate"/);
});

test('start keeps the offer contract while using the Digital Estate visual system', () => {
  const start = read('./start/index.html');
  assert.match(start, /--forest:#10281d/);
  assert.match(start, /--gold:#dcb35f/);
  assert.match(start, /border-radius:28px/);
  assert.match(start, /IntersectionObserver/);
  assert.match(start, /prefers-reduced-motion: reduce/);
  assert.match(start, /\.motion-ready \.reveal-target/);
  assert.match(start, /html \{ overflow-x:clip;/);
  assert.doesNotMatch(start, /body \{[^}]*overflow-x:hidden/);
});

test('active routing code contains no silent legacy offer mapping', () => {
  const crm = read('./api/crm-data.js');
  const onboarding = read('./onboard/index.html');
  const application = read('./apply/index.html');
  const applicationApi = read('./api/apply.js');

  assert.doesNotMatch(crm, /done_with_you_5000|growth_machine|empire_architect/);
  assert.doesNotMatch(onboarding, /'retainer'|AI Operator Retainer|empire:\s*'retainer'/i);
  assert.doesNotMatch(application, /done_with_you_5000|\$5,000/);
  assert.doesNotMatch(applicationApi, /done_with_you_5000/);
  assert.doesNotMatch(application, /Applying for[\s\S]*\$4,997 · scoped 30-day implementation/);
  assert.doesNotMatch(application, /Applying for[\s\S]*\$14,997 · scoped 90-day architecture engagement/);
  assert.match(application, /'done_with_you_4997': \{ label: 'AI System Sprint', context: 'Scoped 30-day implementation' \}/);
  assert.match(application, /'done_for_you_14997': \{ label: 'AI Empire Architect', context: 'Scoped 90-day architecture engagement' \}/);
});

test('higher-tier portal access is explicit and unknown tiers expose no phases', () => {
  const portal = read('./portal/index.html');
  assert.match(portal, /'GrowthEko AI System Sprint': \[0, 1, 2, 3\]/);
  assert.match(portal, /'GrowthEko AI Empire Architect': \[0, 1, 2, 3, 4\]/);
  assert.match(portal, /const allowed = TIER_PHASE_MAP\[CUSTOMER\.tier\] \|\| \[\]/);
  assert.match(portal, /Legacy entitlement — review required/);
});
