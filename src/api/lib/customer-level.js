import { ECOSYSTEM_ENTRY_REGISTRY, OFFER_REGISTRY, resolveEcosystemEntryKey, resolveOfferKey } from './offer-registry.js';

export const CUSTOMER_LEVELS = Object.freeze([
  Object.freeze({ key: 'lead', rank: 0, emoji: '⏳', label: 'Lead', amount: '$0', offerId: null }),
  Object.freeze({ key: 'entry', rank: 1, emoji: '😊', label: 'Entry', amount: '$7', offerId: 'digital_estate' }),
  Object.freeze({ key: 'member', rank: 2, emoji: '💳', label: 'Member', amount: '$97/mo', offerId: 'membership' }),
  Object.freeze({ key: 'premium', rank: 3, emoji: '💎', label: 'Premium', amount: '$1,997', offerId: 'audit' }),
  Object.freeze({ key: 'growth', rank: 4, emoji: '💰', label: 'Growth', amount: '$4,997', offerId: 'sprint' }),
  Object.freeze({ key: 'partner', rank: 5, emoji: '🐋', label: 'Partner', amount: '$14,997', offerId: 'architect' })
]);

const LEVEL_BY_OFFER = new Map(CUSTOMER_LEVELS.filter(level => level.offerId).map(level => [level.offerId, level]));
const PAID_STAGES = new Set(['paid', 'onboarding', 'delivery', 'proof', 'retention_expansion', 'retention expansion']);
const PAID_STATUSES = new Set(['paid', 'won', 'completed']);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

function offerId(value) {
  const ecosystem = resolveEcosystemEntryKey(value);
  if (ecosystem.entryId) return ecosystem.entryId;
  return resolveOfferKey(value).offerId;
}

function offerName(id) {
  return ECOSYSTEM_ENTRY_REGISTRY[id]?.name || OFFER_REGISTRY[id]?.publicName || '';
}

function publicLevel(level) {
  const product = offerName(level.offerId);
  const numeric = level.amount.replace(/[$,]/g, '').replace('/mo', ' monthly');
  return {
    key: level.key,
    rank: level.rank,
    emoji: level.emoji,
    label: level.label,
    tag: `${level.emoji} ${level.label}`,
    amount: level.amount,
    offer_id: level.offerId,
    search_text: [level.emoji, level.label, level.amount, numeric, product, level.offerId, level.rank === 0 ? 'unpaid no payment prospect' : 'paid customer'].filter(Boolean).join(' ')
  };
}

function matchesEntity(record, entity) {
  const email = normalized(entity.email);
  const entityId = normalized(entity.entity_id || entity.id);
  const applicationId = normalized(entity.application_id || (entity.entity_type === 'lead' ? entity.id : ''));
  const customerId = normalized(entity.customer_id || (entity.entity_type === 'customer' ? entity.id : ''));
  return Boolean(
    (email && normalized(record.email) === email) ||
    (entityId && normalized(record.entity_id) === entityId) ||
    (applicationId && normalized(record.application_id) === applicationId) ||
    (customerId && normalized(record.customer_id) === customerId)
  );
}

function paidOpportunity(record) {
  if (record.paid_at) return true;
  const journey = normalized(record.journey_stage || record.stage).replaceAll('-', '_');
  const status = normalized(record.opportunity_status || record.status);
  return PAID_STAGES.has(journey) || PAID_STATUSES.has(status);
}

export function resolveCustomerLevel({ entity = {}, opportunities = [], entitlements = [] } = {}) {
  const matchingEntitlements = entitlements.filter(record => matchesEntity(record, entity));
  const entitlementState = new Map();
  for (const record of matchingEntitlements) {
    const id = offerId(record.entitlement_key);
    if (!id || entitlementState.has(id)) continue;
    entitlementState.set(id, normalized(record.status));
  }

  const paidOfferIds = new Set(
    [...entitlementState.entries()].filter(([, status]) => status === 'paid').map(([id]) => id)
  );

  for (const record of opportunities.filter(opportunity => matchesEntity(opportunity, entity))) {
    const id = record.offer?.id || offerId(record.offer_key || record.source_offer_key);
    if (id && !entitlementState.has(id) && paidOpportunity(record)) paidOfferIds.add(id);
  }

  const mirroredOfferId = entity.offer?.id || offerId(entity.offer_key || entity.tier);
  if (mirroredOfferId && !entitlementState.has(mirroredOfferId) && (Number(entity.amount_paid) > 0 || entity.paid_at)) {
    paidOfferIds.add(mirroredOfferId);
  }

  const level = [...paidOfferIds]
    .map(id => LEVEL_BY_OFFER.get(id))
    .filter(Boolean)
    .sort((a, b) => b.rank - a.rank)[0] || CUSTOMER_LEVELS[0];
  return publicLevel(level);
}

export function applyCustomerLevels(people = [], leads = [], opportunities = [], entitlements = []) {
  const entities = [
    ...people.map(entity => ({ entity, view: { ...entity, entity_type: 'customer' } })),
    ...leads.map(entity => ({ entity, view: { ...entity, entity_type: 'lead' } }))
  ];

  for (const { entity, view } of entities) {
    entity.customer_level = resolveCustomerLevel({ entity: view, opportunities, entitlements });
  }

  for (const opportunity of opportunities) {
    const matched = entities.find(({ view }) => matchesEntity(opportunity, view));
    opportunity.customer_level = matched?.entity.customer_level || resolveCustomerLevel({ entity: opportunity, opportunities: [opportunity], entitlements });
  }

  return { people, leads, opportunities };
}
