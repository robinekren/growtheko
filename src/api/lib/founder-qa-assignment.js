import { COMMERCIAL_ACTIVATION, resolveOfferKey } from './offer-registry.js';

const SOURCE_OFFER_KEY = 'onetime_1997';
const FOUNDER_QA_EMAIL = 'robinekrenn@gmail.com';

export const FOUNDER_QA_ACCESS_ARCHITECTURE = Object.freeze({
  compatible_now: false,
  decision: 'blocked_until_separate_noncommercial_authorization_exists',
  blockers: Object.freeze([
    'Production portal authentication and data loading are implemented in remote Supabase Edge Functions whose source is not present in this repository.',
    'The durable billing entitlement ledger accepts commercial Stripe states and has no separate founder_qa authorization class.',
    'Onboarding authorization requires a paid entitlement, or the legacy paid/active customer mirror; using either would misclassify this QA assignment.',
    'The portal currently derives the visible task set from customer.tier after authenticated loading, so changing the tier alone would be an authorization bypass rather than a source-backed QA grant.'
  ]),
  required_contract: Object.freeze([
    'A separate, revocable founder_qa access-grant source keyed to the verified account email.',
    'Portal-auth and portal-api must return that grant independently from billing entitlement and customer tier.',
    'The portal may map the verified grant to the audit view and tasks, while billing, revenue and customer-level resolvers continue to ignore it.',
    'Grant creation, expiry, revocation and use must be auditable before production activation.'
  ])
});

// This creates a reviewable assignment contract only. It performs no I/O and
// deliberately cannot grant access, recognize revenue or mark an opportunity paid.
export function prepareFounderQaAuditAssignment({ currentGrowthEkoRevenue = 0 } = {}) {
  if (Number(currentGrowthEkoRevenue) !== 0) {
    throw new Error('Founder QA assignment must be prepared against $0 GrowthEko revenue.');
  }

  const resolved = resolveOfferKey(SOURCE_OFFER_KEY);
  if (!resolved.offer || resolved.offerId !== 'audit') {
    throw new Error('Canonical $1,997 audit offer is unavailable.');
  }

  return {
    contract_version: 'growtheko.founder-qa-assignment.v1',
    assignment_key: 'founder_qa:robin_ekren:ai_operator_audit',
    state: 'prepared_only',
    do_not_execute: true,
    subject: {
      name: 'Robin Ekren',
      email: FOUNDER_QA_EMAIL,
      relationship: 'founder_qa',
      customer_record_required_before_execution: true
    },
    offer: {
      source_offer_key: SOURCE_OFFER_KEY,
      offer_id: resolved.offerId,
      name: resolved.offer.publicName,
      list_price: resolved.offer.price,
      list_price_usd: 1997,
      cadence: resolved.offer.cadence,
      registry_status: resolved.offer.status
    },
    accounting: {
      current_growtheko_revenue: 0,
      amount_paid: 0,
      revenue_recognized: 0,
      order_counted: false,
      order_count_delta: 0,
      currency: 'USD'
    },
    entitlement: {
      granted: false,
      status: 'not_paid',
      customer_level_change: false
    },
    test_access: {
      access_class: 'founder_qa',
      principal_email: FOUNDER_QA_EMAIL,
      commercial_order: false,
      order_counted: false,
      paid: false,
      amount_paid: 0,
      revenue_recognized: 0,
      target_offer_id: resolved.offerId,
      target_view: 'GrowthEko AI Operator Audit',
      target_tasks: 'audit_scope_only',
      authorization_state: 'prepared_not_granted',
      can_unlock_with_current_architecture: FOUNDER_QA_ACCESS_ARCHITECTURE.compatible_now,
      architecture_decision: FOUNDER_QA_ACCESS_ARCHITECTURE.decision,
      blockers: FOUNDER_QA_ACCESS_ARCHITECTURE.blockers,
      required_contract: FOUNDER_QA_ACCESS_ARCHITECTURE.required_contract
    },
    opportunity_payload_preview: {
      source_key: 'founder_qa_robin_audit',
      offer_key: resolved.offerId,
      source_offer_key: SOURCE_OFFER_KEY,
      offer_source: 'growtheko_offer',
      stage: 'attention',
      status: 'open',
      amount_recorded: 0,
      amount_unit: 'major',
      currency: 'USD',
      review_required: true,
      evidence: {
        assignment_type: 'founder_qa',
        paid: false,
        revenue_recognized: 0,
        production_write_authorized: false
      }
    },
    execution: {
      database_write: false,
      email_send: false,
      checkout_created: false,
      stripe_event: false,
      paid_entitlement: false,
      deployment: false,
      paid_activation_capacity: COMMERCIAL_ACTIVATION.paidActivationCapacity,
      next_gate: 'Explicit Robin approval plus a canonical customer/application identity before any production record.'
    }
  };
}

export const ROBIN_FOUNDER_QA_AUDIT_ASSIGNMENT = Object.freeze(prepareFounderQaAuditAssignment());
