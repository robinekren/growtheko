import { hasOpsSession, isLocalDevelopmentRequest } from './lib/ops-session.js';
import {
  CUSTOMER_OFFER_LIFECYCLE,
  ECOSYSTEM_ENTRY_REGISTRY,
  OFFER_REGISTRY,
  resolveEcosystemEntryKey,
  resolveOfferKey
} from './lib/offer-registry.js';

const AUTONOMY_PHASES = Object.freeze([
  Object.freeze({
    id: 1,
    key: 'supervised',
    name: 'Phase 1 · Supervised',
    summary: 'Nora prepares the work; Robin controls every external or state-changing execution.',
    nora_may: [
      'Read, classify and verify every source-backed record.',
      'Draft replies, next actions and internal updates.'
    ],
    robin_approves: 'Every customer-visible message, access change and revenue-changing action.',
    unlock_evidence: 'All required playbooks, stop rules and execution logs pass Robin’s supervised evaluation.'
  }),
  Object.freeze({
    id: 2,
    key: 'guarded',
    name: 'Phase 2 · Guarded',
    summary: 'Nora runs reviewed routine communication; Robin keeps the sensitive gates.',
    nora_may: [
      'Execute reviewed routine communication from locked playbooks.',
      'Continue internal diagnosis, documentation and follow-up scheduling.'
    ],
    robin_approves: 'Access, prices, high-ticket offers, contracts, exceptions and sensitive claims.',
    unlock_evidence: 'Guarded runs remain reliable with zero critical policy breach and Robin signs off.'
  }),
  Object.freeze({
    id: 3,
    key: 'bounded',
    name: 'Phase 3 · Bounded',
    summary: 'Nora executes proven playbooks end to end, never outside their verified boundaries.',
    nora_may: [
      'Execute verified playbooks end to end and log every action.',
      'Stop and escalate automatically when facts or policy no longer match.'
    ],
    robin_approves: 'Money movement, legal, security, public claims, destructive actions and policy exceptions.',
    unlock_evidence: 'Final phase. Any critical policy breach forces an immediate supervised review.'
  })
]);

const CUSTOMER_JOURNEY_STEPS = Object.freeze([
  Object.freeze({ id: 'lead', name: 'Lead' }),
  Object.freeze({ id: 'entry-purchased', name: 'Purchased', amounts: Object.freeze(['$7 USD']) }),
  Object.freeze({ id: 'access', name: 'Access delivered' }),
  Object.freeze({ id: 'activated', name: 'Activated' }),
  Object.freeze({ id: 'first-win', name: 'First win' }),
  Object.freeze({ id: 'expansion-diagnosed', name: 'Expansion diagnosed' }),
  Object.freeze({ id: 'qualified', name: 'Qualified' }),
  Object.freeze({ id: 'offer-approved', name: 'Offer approved', amounts: Object.freeze(['$97 USD/mo', '$1,997 USD', '$4,997 USD', '$14,997 USD']) }),
  Object.freeze({ id: 'paid', name: 'Paid' }),
  Object.freeze({ id: 'onboarding', name: 'Onboarding' }),
  Object.freeze({ id: 'delivery', name: 'Delivery' }),
  Object.freeze({ id: 'proof', name: 'Proof' }),
  Object.freeze({ id: 'retention-expansion', name: 'Retention / Expansion' })
]);

function clean(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

function offer(value) {
  const ecosystem = resolveEcosystemEntryKey(clean(value, 80));
  if (ecosystem.entry) {
    return {
      key: ecosystem.key,
      id: ecosystem.entryId,
      name: ecosystem.entry.name,
      price: ecosystem.entry.currentPrice,
      review_required: false,
      source: 'ecosystem_entry'
    };
  }

  const resolved = resolveOfferKey(clean(value, 80));
  if (resolved.offer) {
    const cadence = resolved.offer.cadence === 'monthly' ? '/mo' : '';
    return { key: resolved.key, id: resolved.offerId, name: resolved.offer.publicName, price: `${resolved.offer.price}${cadence}`, review_required: false, source: 'growtheko_offer' };
  }
  return { key: resolved.key, id: null, name: resolved.key === 'unassigned' ? 'Not prescribed' : 'Legacy entitlement', price: 'Review required', review_required: resolved.reviewRequired, source: 'unresolved' };
}

function lifecycleStep(definition) {
  if (definition.source === 'ecosystem_entry') {
    const entry = ECOSYSTEM_ENTRY_REGISTRY[definition.id];
    return entry ? {
      id: entry.id,
      source: definition.source,
      name: entry.name,
      price: entry.currentPrice,
      cadence: entry.cadence
    } : null;
  }

  const registeredOffer = OFFER_REGISTRY[definition.id];
  if (!registeredOffer) return null;
  return {
    id: registeredOffer.id,
    source: definition.source,
    name: registeredOffer.publicName,
    price: registeredOffer.price,
    cadence: registeredOffer.cadence
  };
}

function offerLifecycle(people = [], leads = [], opportunities = []) {
  return CUSTOMER_OFFER_LIFECYCLE.map(lifecycleStep).filter(Boolean).map(step => {
    const scoped = opportunities.filter(opportunity => opportunity.offer?.id === step.id && !['paused', 'closed_lost'].includes(opportunity.status));
    const customers = opportunities.length
      ? scoped.filter(opportunity => opportunity.customer_id).length
      : people.filter(person => person.offer?.id === step.id).length;
    const applicants = opportunities.length
      ? scoped.filter(opportunity => !opportunity.customer_id).length
      : leads.filter(lead => lead.offer?.id === step.id).length;
    return { ...step, customers, applicants, records: customers + applicants };
  });
}

function stage(value) {
  const key = clean(value, 80).toLowerCase();
  if (['active', 'paid', 'sold'].includes(key)) return 'Deliver';
  if (['booked', 'qualified'].includes(key)) return 'Commit';
  if (['applied', 'new_lead', 'lead'].includes(key)) return 'Diagnose';
  if (['completed', 'won'].includes(key)) return 'Prove';
  return 'Attention';
}

function opportunityStage(value) {
  const key = clean(value, 80).toLowerCase();
  if (['lead', 'purchased', 'access', 'activated'].includes(key)) return 'Diagnose';
  if (['expansion_diagnosed', 'qualified', 'offer_approved'].includes(key)) return 'Commit';
  if (['paid', 'onboarding', 'delivery'].includes(key)) return 'Deliver';
  if (['first_win', 'proof', 'retention_expansion'].includes(key)) return 'Prove';
  return 'Attention';
}

function opportunityOffer(record) {
  const key = clean(record?.offer_key, 80).toLowerCase();
  if (key === 'legacy_review') return offer(record?.source_offer_key || key);
  return offer(key === 'unassigned' ? '' : key);
}

function headers(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rows(base, key, path) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: headers(key) });
  if (!response.ok) throw new Error(`CRM source unavailable: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function normalizedEmail(value) {
  return clean(value, 320).toLowerCase();
}

function normalizedStatus(...values) {
  return values.map(value => clean(value, 120).toLowerCase()).filter(Boolean).join(' ');
}

function autonomyPhase(value = 1) {
  const parsed = Number.parseInt(clean(value, 12), 10);
  return Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : 1;
}

function autonomyPolicy(value = process.env.GROWTHEKO_NORA_AUTONOMY_PHASE) {
  const activePhase = autonomyPhase(value || 1);
  return {
    active_phase: activePhase,
    control: 'server',
    phases: AUTONOMY_PHASES.map(phase => ({
      ...phase,
      status: phase.id === activePhase ? 'active' : phase.id < activePhase ? 'proven' : 'locked'
    }))
  };
}

function customerJourney() {
  return CUSTOMER_JOURNEY_STEPS.map(step => ({ ...step }));
}

function deadlineFrom(value, hours, fallback = new Date()) {
  const reference = value ? new Date(value) : new Date(fallback);
  const safeReference = Number.isNaN(reference.getTime()) ? new Date(fallback) : reference;
  return new Date(safeReference.getTime() + (hours * 60 * 60 * 1000)).toISOString();
}

function interactionsFor(entity, interactions) {
  const applicationId = clean(entity.application_id || (entity.entity_type === 'lead' ? entity.id : ''), 140);
  const email = normalizedEmail(entity.email);
  return interactions.filter(interaction => (
    (applicationId && clean(interaction.application_id, 140) === applicationId) ||
    (email && normalizedEmail(interaction.email) === email)
  ));
}

function taskBase(entity, definition) {
  const baseExecutionMode = definition.execution_mode || 'nora';
  const entityId = entity.entity_id || entity.id;
  return {
    id: `${entity.entity_type}:${entityId}:${entity.opportunity_id || 'record'}:${definition.playbook}`,
    entity_id: entityId,
    entity_type: entity.entity_type,
    opportunity_id: entity.opportunity_id || null,
    application_id: entity.application_id || (entity.entity_type === 'lead' ? entity.id : ''),
    person_name: entity.name,
    email: entity.email,
    offer: entity.offer,
    stage: entity.stage,
    priority: definition.priority,
    base_execution_mode: baseExecutionMode,
    execution_mode: baseExecutionMode,
    playbook: definition.playbook,
    action: definition.action,
    reason: definition.reason,
    channel: definition.channel,
    deadline: definition.deadline,
    next_status: definition.next_status,
    stop_condition: definition.stop_condition,
    facts: definition.facts.filter(Boolean),
    recommendation: definition.recommendation || '',
    after_confirmation: definition.after_confirmation || ''
  };
}

function applyAutonomyPolicy(task, phaseValue = 1) {
  const phase = autonomyPhase(phaseValue);
  if (task.base_execution_mode === 'approval') return { ...task, autonomy_phase: phase };

  const externalAction = task.channel !== 'Internal';
  const phaseTwoGate = ['access-recovery', 'onboarding-activation'].includes(task.playbook);
  const requiresApproval = (phase === 1 && externalAction) || (phase === 2 && phaseTwoGate);
  if (!requiresApproval) return { ...task, autonomy_phase: phase };

  const approvalReason = phase === 1
    ? 'Phase 1 requires Robin approval before Nora executes customer-visible, access-changing or revenue-changing work.'
    : 'Phase 2 keeps access and onboarding state changes behind Robin approval.';

  return {
    ...task,
    autonomy_phase: phase,
    execution_mode: 'approval',
    approval_reason: approvalReason,
    facts: [...task.facts, `Active policy: Phase ${phase}`, `Planned channel: ${task.channel}`],
    recommendation: task.recommendation || 'Approve only this playbook when the recipient, scope and verified facts are correct.',
    after_confirmation: task.after_confirmation || 'Nora executes exactly this playbook, records the result and schedules the next control point.'
  };
}

function operationalTask(entity, interactions, now = new Date()) {
  const status = normalizedStatus(entity.status, entity.raw_stage, entity.portal_status, entity.onboarding_status, entity.nora_status, entity.stage);
  const related = interactionsFor(entity, interactions);
  const unread = related
    .filter(item => item.sender_type === 'customer' && item.message_type === 'text' && !item.read_at)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  const risk = ['suspended', 'chargeback', 'dispute', 'past_due', 'refunded', 'security', 'manual_review'].find(term => status.includes(term));

  if (risk) {
    return taskBase(entity, {
      priority: 'P0', execution_mode: 'approval', playbook: 'risk-escalation',
      action: 'Review risk and keep outbound sales paused',
      reason: `A verified account field contains “${risk}”.`, channel: 'Internal',
      deadline: deadlineFrom(null, 0, now), next_status: 'Paused pending decision',
      stop_condition: 'Do not send sales or expansion messages while the risk remains unresolved.',
      facts: [`Status: ${entity.status || entity.raw_stage || entity.stage || 'unknown'}`, `Nora status: ${entity.nora_status || 'not set'}`],
      recommendation: 'Keep automation paused and choose only the recovery, refund or security path supported by the verified account state.',
      after_confirmation: 'Nora records the decision, runs the approved recovery playbook and schedules the next control point.'
    });
  }

  const leadReference = new Date(entity.last_activity_at || entity.submitted_at || entity.created_at || now).getTime();
  const inactiveLead = entity.entity_type === 'lead' && entity.stage === 'Diagnose' && !entity.call_booked &&
    Number.isFinite(leadReference) && (new Date(now).getTime() - leadReference) > (7 * 24 * 60 * 60 * 1000);
  if (inactiveLead) {
    return taskBase(entity, {
      priority: 'P2', playbook: 'inactive-lead-pause', action: 'Pause the inactive lead and stop routine follow-up',
      reason: 'No verified activity or booking exists within the seven-day operating window.', channel: 'Internal',
      deadline: deadlineFrom(null, 0, now), next_status: 'Paused until a new inbound signal',
      stop_condition: 'Resume only after a new verified inbound action, booking or explicit operator decision.',
      facts: [`Last verified activity: ${entity.last_activity_at || entity.submitted_at || entity.created_at || 'not stored'}`, `Current stage: ${entity.stage}`]
    });
  }

  if (entity.offer?.review_required && entity.stage !== 'Diagnose') {
    return taskBase(entity, {
      priority: 'P0', execution_mode: 'approval', playbook: 'offer-mapping-review',
      action: 'Resolve the unmatched offer before continuing',
      reason: 'The stored entitlement or selected tier does not map to the canonical offer registry.', channel: 'Internal',
      deadline: deadlineFrom(entity.submitted_at || entity.created_at, 4, now), next_status: 'Canonical offer confirmed',
      stop_condition: 'Do not send an offer or change access until the mapping is verified.',
      facts: [`Stored offer: ${entity.offer.name}`, `Current stage: ${entity.stage || 'unknown'}`],
      recommendation: 'Map the record to the smallest valid scope supported by evidence, or leave it unassigned.',
      after_confirmation: 'Nora updates the opportunity context and resumes the correct playbook.'
    });
  }

  if (entity.stage === 'Commit' && ['sprint', 'architect'].includes(entity.offer?.id)) {
    const architect = entity.offer.id === 'architect';
    return taskBase(entity, {
      priority: 'P0', execution_mode: 'approval', playbook: 'high-ticket-offer-approval',
      action: `Approve or hold the ${entity.offer.name} offer`,
      reason: 'A high-ticket opportunity reached the commitment gate.', channel: 'Internal',
      deadline: deadlineFrom(entity.call_time || entity.submitted_at || entity.created_at, 4, now), next_status: 'Offer decision recorded',
      stop_condition: 'No high-ticket offer is sent without Robin’s confirmation.',
      facts: [`Offer: ${entity.offer.name} · ${entity.offer.price}`, `Stage: ${entity.stage}`],
      recommendation: architect
        ? 'Approve only when multiple systems and a proven revenue path are verified; otherwise route to the Sprint.'
        : 'Approve only when one bounded, verified bottleneck is ready for implementation; otherwise route to the Audit.',
      after_confirmation: 'Nora sends only the approved scope, logs the communication and schedules the factual follow-up.'
    });
  }

  if (unread) {
    return taskBase(entity, {
      priority: 'P1', playbook: 'customer-message-response',
      action: 'Classify and answer the newest customer message',
      reason: 'A verified inbound customer message is unread.', channel: 'Portal Inbox',
      deadline: deadlineFrom(unread.created_at, 4, now), next_status: 'Customer response sent',
      stop_condition: 'Escalate instead of replying when the message contains legal, security, refund-policy or outcome-claim risk.',
      facts: [`Sender: ${unread.sender_name || 'Customer'}`, `Received: ${unread.created_at || 'unknown'}`]
    });
  }

  if (entity.entity_type === 'customer' && Number(entity.amount_paid) > 0 && !['active', 'ready', 'complete', 'completed'].some(term => normalizedStatus(entity.portal_status).includes(term))) {
    return taskBase(entity, {
      priority: 'P1', playbook: 'access-recovery', action: 'Verify entitlement and deliver portal access',
      reason: 'Payment is recorded but active portal access is not verified.', channel: 'Email',
      deadline: deadlineFrom(entity.paid_at || entity.created_at, 1, now), next_status: 'Access verified',
      stop_condition: 'Stop and escalate if identity or entitlement data conflicts.',
      facts: [`Recorded payment: ${entity.amount_paid} ${entity.currency || 'USD'}`, `Portal status: ${entity.portal_status || 'not set'}`]
    });
  }

  if (entity.entity_type === 'customer' && !['complete', 'completed', 'active', 'ready', 'done'].some(term => normalizedStatus(entity.onboarding_status).includes(term))) {
    return taskBase(entity, {
      priority: 'P1', playbook: 'onboarding-activation', action: 'Prefill onboarding and request only missing facts',
      reason: 'The customer exists, but completed onboarding is not verified.', channel: 'Portal Inbox + Email',
      deadline: deadlineFrom(entity.created_at, 48, now), next_status: 'Onboarding complete',
      stop_condition: 'Do not ask twice for facts already stored in the customer or application record.',
      facts: [`Onboarding status: ${entity.onboarding_status || 'not set'}`, `Offer: ${entity.offer?.name || 'not prescribed'}`]
    });
  }

  if (entity.entity_type === 'lead' && entity.call_booked) {
    return taskBase(entity, {
      priority: 'P1', playbook: 'meeting-preparation', action: 'Prepare the call and send the scheduled reminder',
      reason: 'A verified call is booked.', channel: 'Email',
      deadline: deadlineFrom(entity.call_time, -24, now), next_status: 'Meeting prepared',
      stop_condition: 'Do not make unverified outcome claims in preparation or reminders.',
      facts: [`Call time: ${entity.call_time || 'not stored'}`, `Current offer: ${entity.offer?.name || 'not prescribed'}`]
    });
  }

  if (entity.entity_type === 'lead') {
    return taskBase(entity, {
      priority: 'P2', playbook: 'scope-diagnosis', action: 'Diagnose the smallest useful next scope',
      reason: 'A real application is open and has no higher-priority blocker.', channel: 'Internal',
      deadline: deadlineFrom(entity.submitted_at || entity.created_at, 24, now), next_status: 'Scope diagnosed',
      stop_condition: 'Do not recommend a higher offer without a verified bottleneck and delivery fit.',
      facts: [`Current stage: ${entity.stage || 'unknown'}`, `Selected path: ${entity.offer?.name || 'not prescribed'}`]
    });
  }

  const firstWinVerified = ['first_win', 'first win', 'proof', 'activated'].some(term => normalizedStatus(entity.nora_status, entity.stage).includes(term));
  return taskBase(entity, firstWinVerified ? {
    priority: 'P2', playbook: 'expansion-diagnosis', action: 'Check for a verified expansion signal',
    reason: 'A first-win or proof state is recorded and no higher-priority blocker exists.', channel: 'Internal',
    deadline: deadlineFrom(entity.last_activity_at || entity.created_at, 72, now), next_status: 'Expansion fit documented',
    stop_condition: 'Do not recommend an upsell without a verified signal and a bounded next scope.',
    facts: [`Nora status: ${entity.nora_status || entity.stage || 'verified progress'}`, `Current offer: ${entity.offer?.name || 'not prescribed'}`]
  } : {
    priority: 'P2', playbook: 'first-win-evidence', action: 'Collect one piece of first-win evidence',
    reason: 'Access and onboarding have no higher-priority blocker, but a first win is not verified.', channel: 'Portal Inbox',
    deadline: deadlineFrom(entity.last_activity_at || entity.created_at, 72, now), next_status: 'First win verified',
    stop_condition: 'Ask for one specific proof point and pause expansion messaging until it exists.',
    facts: [`Nora status: ${entity.nora_status || 'not set'}`, `Current offer: ${entity.offer?.name || 'not prescribed'}`]
  });
}

function commandQueue(people = [], leads = [], interactions = [], now = new Date(), phase = 1, opportunityEntities = []) {
  const entities = opportunityEntities.length
    ? opportunityEntities.filter(entity => ['open', 'active'].includes(entity.opportunity_status || entity.status))
    : [
        ...people.map(person => ({ ...person, entity_type: 'customer' })),
        ...leads.map(lead => ({ ...lead, entity_type: 'lead' }))
      ];
  const priority = { P0: 0, P1: 1, P2: 2 };
  return entities.map(entity => applyAutonomyPolicy(operationalTask(entity, interactions, now), phase)).sort((a, b) => (
    (priority[a.priority] ?? 9) - (priority[b.priority] ?? 9) ||
    new Date(a.deadline || 0) - new Date(b.deadline || 0) ||
    a.person_name.localeCompare(b.person_name)
  ));
}

function decisionQueue(queue = []) {
  return queue.filter(task => task.execution_mode === 'approval').map(task => ({
    id: `decision:${task.id}`,
    task_id: task.id,
    entity_id: task.entity_id,
    entity_type: task.entity_type,
    opportunity_id: task.opportunity_id || null,
    person_name: task.person_name,
    email: task.email,
    offer: task.offer,
    priority: task.priority,
    deadline: task.deadline,
    gate: task.approval_reason ? 'Autonomy phase gate' : 'Verified exception',
    playbook: task.playbook,
    happened: task.approval_reason || task.reason,
    verified_facts: task.facts,
    recommendation: task.recommendation,
    after_confirmation: task.after_confirmation
  }));
}

function localScenarioCrm(now = new Date(), policy = autonomyPolicy()) {
  const reference = Number.isNaN(new Date(now).getTime()) ? new Date() : new Date(now);
  const at = hours => new Date(reference.getTime() + (hours * 60 * 60 * 1000)).toISOString();
  const people = [];
  const leads = [
    {
      is_scenario: true,
      id: 'local-test-customer', name: 'Test customer · New application', email: 'test-customer@growtheko.local', company: 'Localhost QA',
      stage: 'Diagnose', raw_stage: 'applied', offer: offer('digital_estate'),
      primary_goal: 'Create one clear digital-estate launch path.',
      biggest_bottleneck: 'The smallest useful next scope has not been diagnosed.',
      submitted_at: at(-5), call_booked: false, call_time: null
    }
  ];
  const interactions = [
    { id: 'local-test-message', application_id: 'local-test-customer', email: 'test-customer@growtheko.local', sender_type: 'team', sender_name: 'Nora', content: 'Application received. Scope diagnosis is queued from the verified intake.', message_type: 'text', metadata: { scenario: true }, read_at: at(-4), created_at: at(-5) }
  ];
  const opportunities = [{
    id: 'local-test-opportunity', opportunity_id: 'local-test-opportunity', opportunity_status: 'open',
    entity_id: 'local-test-customer', entity_type: 'lead', application_id: 'local-test-customer', customer_id: null,
    name: leads[0].name, email: leads[0].email, company: leads[0].company,
    stage: 'Diagnose', journey_stage: 'lead', offer: leads[0].offer,
    primary_goal: leads[0].primary_goal, biggest_bottleneck: leads[0].biggest_bottleneck,
    submitted_at: leads[0].submitted_at, created_at: leads[0].submitted_at,
    call_booked: false, call_time: null, review_required: false
  }];
  const activityEvents = [
    { id: 'local-test-application-event', event_type: 'application_submitted', entity_type: 'application', entity_id: 'local-test-customer', application_id: 'local-test-customer', opportunity_id: 'local-test-opportunity', email: leads[0].email, actor_type: 'customer', actor_name: 'Customer', channel: 'web', summary: 'Application submitted', detail: 'A new application entered the verified intake.', occurred_at: at(-5), source_table: 'applications' },
    { id: 'local-test-message-event', event_type: 'message_stored', entity_type: 'message', entity_id: 'local-test-message', application_id: 'local-test-customer', opportunity_id: 'local-test-opportunity', email: leads[0].email, actor_type: 'nora', actor_name: 'Nora', channel: 'portal_inbox', summary: 'Communication stored', detail: interactions[0].content, occurred_at: at(-5), source_table: 'messages' }
  ];
  const queue = commandQueue(people, leads, interactions, reference, policy.active_phase, opportunities);

  return {
    generated_at: reference.toISOString(),
    autonomy_policy: policy,
    customer_journey: customerJourney(),
    offer_lifecycle: offerLifecycle(people, leads, opportunities),
    people,
    leads,
    opportunities,
    interactions,
    activity_events: activityEvents,
    command_queue: queue,
    decisions: decisionQueue(queue),
    decision_history: [],
    audit_coverage: { active: true, source: 'localhost_scenario', event_count: activityEvents.length },
    local_dev_source_unavailable: true,
    local_dev_scenario_data: true
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!hasOpsSession(req.headers?.cookie)) return res.status(401).json({ error: 'Session expired.' });

  const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!base || !key) {
    if (isLocalDevelopmentRequest(req)) return res.status(200).json(localScenarioCrm());
    return res.status(503).json({ error: 'CRM source unavailable.' });
  }

  try {
    const policy = autonomyPolicy();
    const [customers, applications, messages, opportunityRows, auditRows, storedDecisionRows, billingEventRows] = await Promise.all([
      rows(base, key, 'customers?select=id,email,name,company,tier,status,portal_status,onboarding_status,nora_status,amount_paid,currency,paid_at,last_activity_at,created_at,updated_at&order=created_at.desc&limit=500'),
      rows(base, key, 'applications?select=id,email,first_name,last_name,preferred_name,website,product_type,stage,status,selected_tier,goal,dream_outcome,biggest_challenge,holding_back,submitted_at,call_status,call_date,internal_notes,tags,created_at&order=created_at.desc&limit=500'),
      rows(base, key, 'messages?select=id,application_id,sender_type,sender_name,content,message_type,metadata,read_at,created_at&order=created_at.desc&limit=1000'),
      rows(base, key, 'opportunities?select=id,source_key,customer_id,application_id,offer_key,source_offer_key,offer_source,stage,status,amount_recorded,amount_unit,currency,review_required,evidence,opened_at,paid_at,closed_at,created_at,updated_at&order=updated_at.desc&limit=1000'),
      rows(base, key, 'ops_audit_events?select=id,event_key,actor_type,actor_id,event_type,entity_type,entity_id,customer_id,application_id,opportunity_id,source_table,source_record_id,channel,summary,metadata,occurred_at,created_at&order=occurred_at.desc&limit=5000'),
      rows(base, key, 'ops_decisions?select=id,decision_key,task_id,customer_id,application_id,opportunity_id,status,gate,question,recommendation,verified_facts,requested_by,requested_at,resolution,resolved_by,resolved_at,metadata,created_at,updated_at&order=requested_at.desc&limit=1000'),
      rows(base, key, 'stripe_webhook_events?select=event_id,event_type,event_created_at,stripe_customer_id,offer_key,status,error,payload&order=event_created_at.desc&limit=2000')
    ]);

    const applicationsByEmail = new Map();
    const applicationById = new Map();
    for (const application of applications) {
      const email = normalizedEmail(application.email);
      if (email && !applicationsByEmail.has(email)) applicationsByEmail.set(email, application);
      applicationById.set(String(application.id), application);
    }

    const customerEmails = new Set(customers.map(customer => normalizedEmail(customer.email)).filter(Boolean));
    const customerById = new Map(customers.map(customer => [String(customer.id), customer]));
    const people = customers.map(customer => {
      const application = applicationsByEmail.get(normalizedEmail(customer.email)) || null;
      const prescribed = offer(customer.tier || application?.selected_tier);
      return {
        id: clean(customer.id, 140),
        application_id: clean(application?.id, 140),
        name: clean(customer.name || application?.preferred_name || `${application?.first_name || ''} ${application?.last_name || ''}`.trim() || 'Customer', 160),
        email: normalizedEmail(customer.email),
        company: clean(customer.company || application?.website || application?.product_type, 200),
        status: clean(customer.status || 'unknown', 80),
        portal_status: clean(customer.portal_status, 80),
        onboarding_status: clean(customer.onboarding_status, 80),
        nora_status: clean(customer.nora_status, 80),
        amount_paid: Number(customer.amount_paid) || 0,
        currency: clean(customer.currency || 'USD', 10).toUpperCase(),
        paid_at: customer.paid_at || null,
        last_activity_at: customer.last_activity_at || null,
        created_at: customer.created_at || null,
        stage: stage(customer.status || application?.stage),
        offer: prescribed,
        primary_goal: clean(application?.goal || application?.dream_outcome, 1200),
        biggest_bottleneck: clean(application?.biggest_challenge || application?.holding_back, 1200),
        call_booked: ['booked', 'scheduled', 'confirmed'].includes(clean(application?.call_status, 40).toLowerCase()),
        call_time: application?.call_date || null
      };
    });

    const leads = applications.filter(application => !customerEmails.has(normalizedEmail(application.email))).map(application => ({
      id: clean(application.id, 140),
      name: clean(application.preferred_name || `${application.first_name || ''} ${application.last_name || ''}`.trim() || 'Applicant', 160),
      email: normalizedEmail(application.email),
      company: clean(application.website || application.product_type, 200),
      stage: stage(application.stage || application.status),
      raw_stage: clean(application.stage || application.status, 80),
      offer: offer(application.selected_tier),
      primary_goal: clean(application.goal || application.dream_outcome, 1200),
      biggest_bottleneck: clean(application.biggest_challenge || application.holding_back, 1200),
      submitted_at: application.submitted_at || application.created_at || null,
      call_booked: ['booked', 'scheduled', 'confirmed'].includes(clean(application.call_status, 40).toLowerCase()),
      call_time: application.call_date || null
    }));

    const interactions = messages.map(message => {
      const application = applicationById.get(String(message.application_id));
      return {
        id: clean(message.id, 140),
        application_id: clean(message.application_id, 140),
        email: normalizedEmail(application?.email),
        sender_type: clean(message.sender_type, 40),
        sender_name: clean(message.sender_name, 160),
        content: clean(message.content, 30000),
        message_type: clean(message.message_type || 'text', 60),
        metadata: message.metadata && typeof message.metadata === 'object' ? message.metadata : {},
        read_at: message.read_at || null,
        created_at: message.created_at || null
      };
    });

    const peopleById = new Map(people.map(person => [String(person.id), person]));
    const opportunities = opportunityRows.map(record => {
      const person = peopleById.get(String(record.customer_id)) || null;
      const application = applicationById.get(String(record.application_id)) ||
        (person ? applicationsByEmail.get(normalizedEmail(person.email)) : null) || null;
      const entityType = person ? 'customer' : 'lead';
      const entityId = clean(person?.id || application?.id, 140);
      const prescribed = opportunityOffer(record);
      return {
        id: clean(record.id, 140),
        opportunity_id: clean(record.id, 140),
        opportunity_status: clean(record.status, 80),
        entity_id: entityId,
        entity_type: entityType,
        customer_id: clean(record.customer_id, 140) || null,
        application_id: clean(record.application_id || application?.id, 140) || null,
        name: clean(person?.name || application?.preferred_name || `${application?.first_name || ''} ${application?.last_name || ''}`.trim() || 'Opportunity', 160),
        email: normalizedEmail(person?.email || application?.email),
        company: clean(person?.company || application?.website || application?.product_type, 200),
        status: clean(person?.status || application?.status || record.status, 80),
        raw_stage: clean(application?.stage || record.stage, 80),
        stage: opportunityStage(record.stage),
        journey_stage: clean(record.stage, 80),
        offer: prescribed,
        source_offer_key: clean(record.source_offer_key, 80),
        review_required: Boolean(record.review_required),
        amount_recorded: record.amount_recorded === null ? null : Number(record.amount_recorded),
        amount_unit: clean(record.amount_unit, 20),
        amount_paid: Number(person?.amount_paid) || 0,
        currency: clean(record.currency || person?.currency || 'USD', 10).toUpperCase(),
        paid_at: record.paid_at || person?.paid_at || null,
        opened_at: record.opened_at || record.created_at || null,
        created_at: record.created_at || null,
        updated_at: record.updated_at || null,
        submitted_at: application?.submitted_at || application?.created_at || record.opened_at || null,
        last_activity_at: person?.last_activity_at || application?.last_message_at || application?.submitted_at || record.updated_at || null,
        portal_status: person?.portal_status || '',
        onboarding_status: person?.onboarding_status || application?.onboarding_status || '',
        nora_status: person?.nora_status || '',
        primary_goal: clean(application?.goal || application?.dream_outcome, 1200),
        biggest_bottleneck: clean(application?.biggest_challenge || application?.holding_back, 1200),
        call_booked: ['booked', 'scheduled', 'confirmed'].includes(clean(application?.call_status, 40).toLowerCase()),
        call_time: application?.call_date || null,
        evidence: record.evidence && typeof record.evidence === 'object' ? record.evidence : {}
      };
    });

    const auditActivity = auditRows.map(event => {
      const customer = customerById.get(String(event.customer_id)) || null;
      const application = applicationById.get(String(event.application_id)) ||
        (customer ? applicationsByEmail.get(normalizedEmail(customer.email)) : null) || null;
      const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
      const after = metadata.after && typeof metadata.after === 'object' ? metadata.after : {};
      const detail = clean(metadata.content || after.content || metadata.detail || event.summary, 30000);
      return {
        id: `audit:${clean(event.id, 140)}`,
        event_type: clean(event.event_type, 100),
        entity_type: clean(event.entity_type, 80),
        entity_id: clean(event.entity_id, 140),
        customer_id: clean(event.customer_id, 140) || null,
        application_id: clean(event.application_id || application?.id, 140) || null,
        opportunity_id: clean(event.opportunity_id, 140) || null,
        email: normalizedEmail(customer?.email || application?.email || metadata.email || after.email),
        actor_type: clean(event.actor_type, 40),
        actor_name: clean(metadata.sender_name || after.sender_name || event.actor_id || event.actor_type || 'System', 160),
        channel: clean(event.channel || metadata.channel || 'internal', 80),
        summary: clean(event.summary, 500),
        detail,
        source_table: clean(event.source_table, 100),
        source_record_id: clean(event.source_record_id, 140),
        occurred_at: event.occurred_at || event.created_at || null,
        metadata
      };
    });

    const billingActivity = billingEventRows.map(event => {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      const customer = payload.customer && typeof payload.customer === 'object' ? payload.customer : {};
      const email = normalizedEmail(customer.email);
      const application = applicationsByEmail.get(email) || null;
      const matchedCustomer = customers.find(row => normalizedEmail(row.email) === email) || null;
      return {
        id: `stripe:${clean(event.event_id, 180)}`,
        event_type: clean(event.event_type, 100),
        entity_type: 'billing_event',
        entity_id: clean(event.event_id, 180),
        customer_id: clean(matchedCustomer?.id, 140) || null,
        application_id: clean(application?.id, 140) || null,
        opportunity_id: null,
        email,
        actor_type: 'webhook',
        actor_name: 'Stripe',
        channel: 'billing',
        summary: clean(event.event_type, 160).replaceAll('.', ' '),
        detail: event.status === 'failed' ? `Failed · ${clean(event.error, 500)}` : `Stripe event ${clean(event.status, 40)}`,
        source_table: 'stripe_webhook_events',
        source_record_id: clean(event.event_id, 180),
        occurred_at: event.event_created_at || null,
        metadata: { status: clean(event.status, 40), offer_key: clean(event.offer_key, 80), stripe_customer_id: clean(event.stripe_customer_id, 100) }
      };
    });
    const activityEvents = [...auditActivity, ...billingActivity]
      .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));

    const generatedQueue = commandQueue(people, leads, interactions, new Date(), policy.active_phase, opportunities);
    const storedDecisionByTask = new Map();
    for (const item of storedDecisionRows) {
      const taskId = clean(item.task_id, 500);
      if (taskId && !storedDecisionByTask.has(taskId)) storedDecisionByTask.set(taskId, item);
    }
    const queue = generatedQueue.flatMap(task => {
      const recorded = storedDecisionByTask.get(task.id);
      if (!recorded || recorded.status === 'open') return [task];
      if (['held', 'rejected', 'superseded'].includes(recorded.status)) return [];
      if (['approved', 'executed'].includes(recorded.status)) {
        return [{
          ...task,
          execution_mode: 'nora',
          approval_recorded: true,
          approval_reason: 'Robin approval is stored in the decision ledger. No external execution occurred when approval was recorded.'
        }];
      }
      return [task];
    });
    const generatedDecisions = decisionQueue(queue);
    const openStoredDecisions = storedDecisionRows.filter(item => item.status === 'open').map(item => ({
      id: `stored:${clean(item.id, 140)}`,
      decision_key: clean(item.decision_key, 240),
      task_id: clean(item.task_id, 240),
      entity_id: clean(item.customer_id || item.application_id, 140),
      entity_type: item.customer_id ? 'customer' : 'lead',
      opportunity_id: clean(item.opportunity_id, 140) || null,
      person_name: peopleById.get(String(item.customer_id))?.name || applicationById.get(String(item.application_id))?.preferred_name || 'Source record',
      email: peopleById.get(String(item.customer_id))?.email || normalizedEmail(applicationById.get(String(item.application_id))?.email),
      offer: opportunities.find(opportunity => opportunity.id === String(item.opportunity_id))?.offer || offer(''),
      priority: clean(item.metadata?.priority || 'P1', 10),
      deadline: item.metadata?.deadline || item.requested_at,
      gate: clean(item.gate, 500),
      playbook: clean(item.metadata?.playbook || 'stored-decision', 100),
      happened: clean(item.question, 1200),
      verified_facts: Array.isArray(item.verified_facts) ? item.verified_facts.map(value => clean(value, 1200)) : [],
      recommendation: clean(item.recommendation, 1200),
      after_confirmation: clean(item.metadata?.after_confirmation, 1200)
    }));
    const generatedTaskIds = new Set(generatedDecisions.map(item => item.task_id));
    const decisions = [...generatedDecisions, ...openStoredDecisions.filter(item => !generatedTaskIds.has(item.task_id))];
    const decisionHistory = storedDecisionRows.filter(item => item.status !== 'open').map(item => ({
      id: clean(item.id, 140),
      person_name: peopleById.get(String(item.customer_id))?.name || applicationById.get(String(item.application_id))?.preferred_name || 'Nora Ops',
      project: 'GrowthEko OPS',
      happened: clean(item.question, 1200),
      outcome: clean(item.resolution || item.status, 1200),
      status: clean(item.status, 40),
      created_at: item.created_at || item.requested_at || null,
      resolved_at: item.resolved_at || item.updated_at || null
    }));
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      autonomy_policy: policy,
      customer_journey: customerJourney(),
      offer_lifecycle: offerLifecycle(people, leads, opportunities),
      people,
      leads,
      opportunities,
      interactions,
      activity_events: activityEvents,
      command_queue: queue,
      decisions,
      decision_history: decisionHistory,
      audit_coverage: {
        active: true,
        source: 'append_only_ledger',
        event_count: activityEvents.length,
        opportunity_count: opportunities.length,
        durable_billing_events: billingEventRows.length
      }
    });
  } catch (error) {
    console.error('crm-data:', error?.message || error);
    if (isLocalDevelopmentRequest(req)) return res.status(200).json(localScenarioCrm());
    return res.status(503).json({ error: 'CRM source unavailable.' });
  }
}

export {
  autonomyPolicy as canonicalAutonomyPolicy,
  commandQueue as canonicalCommandQueue,
  customerJourney as canonicalCustomerJourney,
  decisionQueue as canonicalDecisionQueue,
  localScenarioCrm as canonicalLocalScenarioCrm,
  offer as canonicalOffer,
  offerLifecycle as canonicalOfferLifecycle,
  stage as canonicalStage
};
