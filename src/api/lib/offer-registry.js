export const OFFER_REGISTRY_VERSION = '2026-08-23.3';
export const BILLING_TERMS_VERSION = '2026-08-23-v1.2';

export const OFFER_REGISTRY = Object.freeze({
  starter: Object.freeze({
    id: 'starter', name: 'GrowthEko Operator Starter', publicName: 'Operator Starter',
    price: '$0', cadence: 'free', route: '/calculator', status: 'active_free',
    scope: 'Self-serve playbook, profile, action card, starter prompt and scenario calculator.',
    finishLine: 'One documented direction and next action.',
    conditionalCapacity: 'Self-serve; no paid activation capacity.'
  }),
  membership: Object.freeze({
    id: 'membership', name: 'GrowthEko Operator Membership', publicName: 'Operator Membership',
    price: '$97 USD', cadence: 'monthly', route: '/start?checkout=monthly_97', status: 'blocked_gate_a',
    scope: 'Self-directed weekly operating rhythm, group guidance, frameworks, templates and member resources.',
    finishLine: 'Each week ends with one evidence-based next move.',
    conditionalCapacity: 'Review at 100 active paid memberships.'
  }),
  audit: Object.freeze({
    id: 'audit', name: 'GrowthEko AI Operator Audit', publicName: 'AI Operator Audit',
    price: '$1,997 USD', cadence: 'one_time', route: '/start?checkout=onetime_1997', status: 'blocked_gate_a',
    primaryCta: 'Start your AI Operator Audit',
    scope: 'Bounded diagnosis, opportunity map, prioritized implementation roadmap and handoff walkthrough.',
    finishLine: 'The documented roadmap is delivered and explained.',
    conditionalCapacity: 'Maximum 2 active audits and 4 starts per month.'
  }),
  sprint: Object.freeze({
    id: 'sprint', name: 'GrowthEko AI System Sprint', publicName: 'AI System Sprint',
    price: '$4,997 USD', cadence: 'one_time', route: '/apply?offer=done_with_you_4997', status: 'application_only_blocked_gate_b',
    scope: 'Exactly one agreed System Unit implemented in a bounded 30-day engagement.',
    finishLine: 'The agreed System Unit passes its written acceptance test.',
    conditionalCapacity: 'Maximum 2 active sprints and 2 starts per month.'
  }),
  architect: Object.freeze({
    id: 'architect', name: 'GrowthEko AI Empire Architect', publicName: 'AI Empire Architect',
    price: '$14,997 USD', cadence: 'one_time', route: '/apply?offer=done_for_you_14997', status: 'application_only_blocked_gate_c',
    scope: 'Up to three connected System Units around one verified revenue path in 90 days.',
    finishLine: 'The scoped units pass their written acceptance criteria and are handed off.',
    conditionalCapacity: 'Maximum 2 active engagements and 1 start per month.'
  })
});

// Separate RobinEkren acquisition products remain visible without being treated as
// GrowthEko delivery containers, entitlements or revenue attribution.
export const ECOSYSTEM_ENTRY_REGISTRY = Object.freeze({
  digital_estate: Object.freeze({
    id: 'digital_estate',
    name: 'AI Digital Estate Launch System',
    brand: 'RobinEkren',
    operator: 'Robin Ekren',
    route: 'https://www.robinekren.com/digital-estate',
    termsRoute: 'https://www.robinekren.com/digital-estate-terms',
    currentPrice: '$7 USD',
    cadence: 'one_time',
    status: 'active_offer',
    normalPrice: '$97 USD',
    normalPriceDisplay: 'crossed_out',
    scope: 'Interactive Launch Desk, positioning builder, content prompts, monetization map and seven-day action board.',
    finishLine: 'One digital-estate concept and the next seven actions are documented.',
    growthEkoContainer: false,
    revenueAttribution: 'robinekren_digital_estate'
  })
});

export const ECOSYSTEM_ENTRY_KEYS = Object.freeze({
  digital_estate: 'digital_estate',
  digital_estate_founder_7: 'digital_estate',
  digital_estate_standard_97: 'digital_estate'
});

// Canonical commercial journey shown in the operator CRM. Product facts stay
// in their registries above; this list owns only the intended progression.
export const CUSTOMER_OFFER_LIFECYCLE = Object.freeze([
  Object.freeze({ source: 'ecosystem_entry', id: 'digital_estate' }),
  Object.freeze({ source: 'growtheko_offer', id: 'membership' }),
  Object.freeze({ source: 'growtheko_offer', id: 'audit' }),
  Object.freeze({ source: 'growtheko_offer', id: 'sprint' }),
  Object.freeze({ source: 'growtheko_offer', id: 'architect' })
]);

export function resolveEcosystemEntryKey(value) {
  const key = String(value || '').trim().toLowerCase();
  const entryId = ECOSYSTEM_ENTRY_KEYS[key];
  if (entryId) return { key, entryId, entry: ECOSYSTEM_ENTRY_REGISTRY[entryId] };
  return { key: key || 'unassigned', entryId: null, entry: null };
}

export const CURRENT_OFFER_KEYS = Object.freeze({
  monthly_97: 'membership', membership: 'membership',
  onetime_1997: 'audit', audit: 'audit', roadmap_1997: 'audit',
  done_with_you_4997: 'sprint', sprint: 'sprint',
  done_for_you_14997: 'architect', architect: 'architect'
});

export const QUARANTINED_OFFER_KEYS = Object.freeze(new Set([
  'growth', 'done_with_you_5000', 'growth_machine', 'empire',
  'empire_architect', 'retainer', 'premium_implementation', 'secret'
]));

export function resolveOfferKey(value) {
  const key = String(value || '').trim().toLowerCase();
  const offerId = CURRENT_OFFER_KEYS[key];
  if (offerId) return { key, offerId, offer: OFFER_REGISTRY[offerId], reviewRequired: false };
  return { key: key || 'unassigned', offerId: null, offer: null, reviewRequired: Boolean(key) };
}

export const COMMERCIAL_ACTIVATION = Object.freeze({
  paidActivationCapacity: 0,
  reason: 'Gate A remains blocked; Gates B and C remain unopened.',
  taxBasis: 'All paid prices are net USD plus applicable taxes; non-Austrian orders require manual review.'
});
