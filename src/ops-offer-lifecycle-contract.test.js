import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalAutonomyPolicy,
  canonicalCommandQueue,
  canonicalCustomerJourney,
  canonicalDecisionQueue,
  canonicalLocalScenarioCrm,
  canonicalOffer,
  canonicalOfferLifecycle
} from './api/crm-data.js';
import { CUSTOMER_OFFER_LIFECYCLE } from './api/lib/offer-registry.js';

test('operator lifecycle follows the canonical commercial journey', () => {
  assert.deepEqual(
    CUSTOMER_OFFER_LIFECYCLE.map(step => step.id),
    ['digital_estate', 'membership', 'audit', 'sprint', 'architect']
  );

  const lifecycle = canonicalOfferLifecycle([], []);
  assert.deepEqual(lifecycle.map(step => step.id), [
    'digital_estate',
    'membership',
    'audit',
    'sprint',
    'architect'
  ]);
  assert.deepEqual(lifecycle.map(step => step.price), [
    '$7 USD',
    '$97 USD',
    '$1,997 USD',
    '$4,997 USD',
    '$14,997 USD'
  ]);
});

test('customer journey keeps every operational micro-step between offer steps', () => {
  assert.deepEqual(canonicalCustomerJourney().map(step => step.name), [
    'Lead', 'Purchased', 'Access delivered', 'Activated', 'First win',
    'Expansion diagnosed', 'Qualified', 'Offer approved', 'Paid', 'Onboarding',
    'Delivery', 'Proof', 'Retention / Expansion'
  ]);
  assert.deepEqual(
    canonicalCustomerJourney().flatMap(step => step.amounts || []),
    ['$7 USD', '$97 USD/mo', '$1,997 USD', '$4,997 USD', '$14,997 USD']
  );
});

test('Digital Estate aliases resolve without becoming GrowthEko delivery offers', () => {
  const founder = canonicalOffer('digital_estate_founder_7');
  assert.equal(founder.id, 'digital_estate');
  assert.equal(founder.source, 'ecosystem_entry');
  assert.equal(founder.name, 'AI Digital Estate Launch System');
  assert.equal(founder.price, '$7 USD');
});

test('operator lifecycle counts real records without adding demo entities', () => {
  const lifecycle = canonicalOfferLifecycle(
    [
      { offer: canonicalOffer('digital_estate_founder_7') },
      { offer: canonicalOffer('membership') }
    ],
    [
      { offer: canonicalOffer('done_with_you_4997') },
      { offer: canonicalOffer('done_for_you_14997') }
    ]
  );

  assert.deepEqual(lifecycle.map(step => step.records), [1, 1, 0, 1, 1]);
  assert.deepEqual(lifecycle.map(step => step.customers), [1, 1, 0, 0, 0]);
  assert.deepEqual(lifecycle.map(step => step.applicants), [0, 0, 0, 1, 1]);
});

test('Ops template renders lifecycle metadata supplied by the API', () => {
  const template = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
  assert.match(template, /id="offerLifecycle"/);
  assert.match(template, /state\.data\.offer_lifecycle/);
  assert.match(template, /<h2>Offer ladder<\/h2>/);
  assert.match(template, /Customer lifecycle/);
  assert.match(template, /state\.data\.customer_journey/);
  assert.doesNotMatch(template, /\$4,997|\$14,997|AI Digital Estate Launch System/);
});

test('command queue assigns exactly one source-backed next action to every real record', () => {
  const queue = canonicalCommandQueue(
    [
      {
        id: 'customer-access', name: 'Access Customer', email: 'access@example.com',
        amount_paid: 7, currency: 'USD', portal_status: '', onboarding_status: '',
        stage: 'Deliver', offer: canonicalOffer('digital_estate'), paid_at: '2026-08-27T09:00:00.000Z'
      },
      {
        id: 'customer-risk', name: 'Risk Customer', email: 'risk@example.com',
        status: 'suspended', stage: 'Attention', offer: canonicalOffer('membership')
      }
    ],
    [
      {
        id: 'lead-one', name: 'Lead One', email: 'lead@example.com', stage: 'Diagnose',
        offer: canonicalOffer('audit'), submitted_at: '2026-08-27T08:00:00.000Z'
      }
    ],
    [],
    new Date('2026-08-27T12:00:00.000Z')
  );

  assert.equal(queue.length, 3);
  assert.equal(new Set(queue.map(item => `${item.entity_type}:${item.entity_id}`)).size, 3);
  assert.equal(queue.find(item => item.entity_id === 'customer-access').playbook, 'access-recovery');
  assert.equal(queue.find(item => item.entity_id === 'lead-one').playbook, 'scope-diagnosis');

  const decisions = canonicalDecisionQueue(queue);
  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map(item => item.entity_id).sort(), ['customer-access', 'customer-risk']);
  assert.equal(decisions.find(item => item.entity_id === 'customer-access').gate, 'Autonomy phase gate');
  assert.deepEqual(Object.keys(decisions[0]).includes('verified_facts'), true);
});

test('autonomy policy is server-controlled and defaults to supervised', () => {
  const supervised = canonicalAutonomyPolicy('not-a-phase');
  assert.equal(supervised.active_phase, 1);
  assert.equal(supervised.control, 'server');
  assert.deepEqual(supervised.phases.map(phase => phase.status), ['active', 'locked', 'locked']);

  const guarded = canonicalAutonomyPolicy('2');
  assert.equal(guarded.active_phase, 2);
  assert.deepEqual(guarded.phases.map(phase => phase.status), ['proven', 'active', 'locked']);
});

test('autonomy phases promote only allowed playbooks', () => {
  const accessCustomer = {
    id: 'customer-access', name: 'Access Customer', email: 'access@example.com',
    amount_paid: 7, currency: 'USD', portal_status: '', onboarding_status: '',
    stage: 'Deliver', offer: canonicalOffer('digital_estate'), paid_at: '2026-08-27T09:00:00.000Z'
  };
  const highTicketLead = {
    id: 'lead-high-ticket', name: 'High Ticket Lead', email: 'high@example.com',
    stage: 'Commit', offer: canonicalOffer('sprint'), submitted_at: '2026-08-27T08:00:00.000Z'
  };
  const now = new Date('2026-08-27T12:00:00.000Z');

  const phaseOne = canonicalCommandQueue([accessCustomer], [highTicketLead], [], now, 1);
  const phaseThree = canonicalCommandQueue([accessCustomer], [highTicketLead], [], now, 3);

  assert.equal(phaseOne.find(item => item.entity_id === 'customer-access').execution_mode, 'approval');
  assert.equal(phaseThree.find(item => item.entity_id === 'customer-access').execution_mode, 'nora');
  assert.equal(phaseThree.find(item => item.entity_id === 'lead-high-ticket').execution_mode, 'approval');
});

test('localhost scenario source exposes exactly one labelled test customer at the first pipeline stage', () => {
  const data = canonicalLocalScenarioCrm(
    new Date('2026-08-27T12:00:00.000Z'),
    canonicalAutonomyPolicy('1')
  );
  const records = [...data.people, ...data.leads];

  assert.equal(data.local_dev_scenario_data, true);
  assert.equal(data.people.length, 0);
  assert.equal(data.leads.length, 1);
  assert.equal(records.length, 1);
  assert.equal(data.command_queue.length, 1);
  assert.equal(data.decisions.length, 1);
  assert.equal(data.interactions.length, 2);
  assert.equal(data.opportunities.length, 1);
  assert.equal(data.activity_events.length, 3);
  assert.equal(data.audit_coverage.active, true);
  assert.equal(data.command_queue[0].opportunity_id, data.opportunities[0].id);
  assert.equal(records[0].is_scenario, true);
  assert.equal(records[0].name, 'Test customer · New application');
  assert.equal(records[0].stage, 'Diagnose');
  assert.equal(records[0].customer_level.tag, '⏳ Lead');
  assert.equal(data.opportunities[0].customer_level.tag, '⏳ Lead');
  assert.equal(data.command_queue[0].playbook, 'customer-message-response');
  assert.deepEqual(data.offer_lifecycle.map(step => step.records), [1, 0, 0, 0, 0]);
});

test('/ops is canonical and exposes exactly the five final Nora modules', () => {
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  const template = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('./api/ops-auth.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('./api/ops-page.js', import.meta.url), 'utf8');

  assert.equal(vercel.redirects.some(entry => entry.source === '/ops'), false);
  assert.deepEqual(vercel.redirects.find(entry => entry.source === '/crm'), {
    source: '/crm', destination: '/ops', permanent: false
  });
  assert.equal(vercel.rewrites.some(entry => entry.source === '/crm'), false);
  assert.match(template, /class="sidebar"/);
  assert.match(template, /data-side-nav/);
  assert.match(template, /data-view="queue"/);
  assert.match(template, /data-view="customers"/);
  assert.match(template, /data-view="pipeline"/);
  assert.match(template, /data-view="inbox"/);
  assert.match(template, /data-view="decisions"/);
  assert.equal((template.match(/data-view="/g) || []).length, 5);
  assert.match(template, /Command Queue/);
  assert.match(template, /Customer 360/);
  assert.match(template, /title:'Pipeline'/);
  assert.match(template, /title:'Inbox'/);
  assert.match(template, /Robin approval only/);
  assert.match(template, /Gate A readiness/);
  assert.match(template, /commercial_activation/);
  assert.match(template, /requestedView/);
  assert.match(template, /syncViewUrl/);
  assert.match(template, /Open Customer 360/);
  assert.match(template, /1 · What happened/);
  assert.match(template, /4 · After confirmation/);
  assert.match(template, /id="autonomyPanel"/);
  assert.match(template, /Inspect only · server-controlled/);
  assert.match(template, /id="decisionHistory"/);
  assert.match(template, /No resolved decision has been recorded yet/);
  assert.match(template, /Customer timeline/);
  assert.match(template, /state\.data\.opportunities/);
  assert.match(template, /state\.data\.activity_events/);
  assert.match(template, /AUDIT LEDGER/);
  assert.match(template, /Approve & queue/);
  assert.match(template, /No external action runs from this click/);
  assert.match(template, /LOCAL SCENARIOS · NOT PRODUCTION/);
  assert.doesNotMatch(template, /data-view="(?:revenue|conversations|meetings)"/);
  assert.doesNotMatch(template, /Acme Corp|Globex|Wayne Enterprises/);
  assert.doesNotMatch(template, /aria-label="CRM views"|class="nav"/);
  assert.doesNotMatch(template, /next=\/crm/);
  assert.doesNotMatch(auth, /redirect: '\/crm'/);
  assert.doesNotMatch(page, /next=\/crm/);
  assert.match(page, /encodeURIComponent\(next\)/);
});
