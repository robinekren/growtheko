import { COMMERCIAL_ACTIVATION, resolveOfferKey } from './offer-registry.js';

const SOURCE_OFFER_KEY = 'onetime_1997';
const FOUNDER_QA_EMAIL = 'robinekrenn@gmail.com';

export const FOUNDER_QA_ACCESS_ARCHITECTURE = Object.freeze({
  compatible_now: true,
  decision: 'separate_noncommercial_authorization_implemented',
  blockers: Object.freeze([]),
  required_contract: Object.freeze([
    'The existing portal session must be verified before any founder_qa lookup.',
    'The latest append-only founder_qa access event independently grants or revokes the audit view.',
    'Billing entitlement, customer tier, paid state, customer level and revenue remain unchanged.',
    'Only the exact verified founder identity may receive the zero-value audit overlay.'
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
      authorization_state: 'requires_active_audited_grant',
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
