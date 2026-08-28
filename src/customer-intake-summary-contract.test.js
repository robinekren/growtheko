import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  CUSTOMER_INTAKE_FIELDS,
  CUSTOMER_INTAKE_NORMALIZATION_STYLE,
  canonicalCustomerIntakeSummary
} from './api/lib/customer-intake-summary.js';
import {
  FOUNDER_QA_ACCESS_ARCHITECTURE,
  ROBIN_FOUNDER_QA_AUDIT_ASSIGNMENT,
  prepareFounderQaAuditAssignment
} from './api/lib/founder-qa-assignment.js';
import { resolveCustomerLevel } from './api/lib/customer-level.js';
import { canonicalLocalScenarioCrm } from './api/crm-data.js';

test('canonical intake contract contains exactly the 48 customer answers and excludes identity email', () => {
  assert.equal(CUSTOMER_INTAKE_FIELDS.length, 48);
  assert.equal(new Set(CUSTOMER_INTAKE_FIELDS.map(field => field.key)).size, 48);
  assert.equal(CUSTOMER_INTAKE_FIELDS.some(field => field.key === 'email'), false);
  assert.deepEqual(
    CUSTOMER_INTAKE_FIELDS.map(field => field.number),
    Array.from({ length: 48 }, (_, index) => index + 1)
  );
});

test('summary keeps raw answers, normalizes display only and flags every missing fact without inference', () => {
  const rows = [
    { session_id: 'session-1', field_name: 'name', field_value: ' Robin Ekren ' },
    { session_id: 'session-1', field_name: 'monthly_revenue', field_value: '$0' },
    { session_id: 'session-1', field_name: 'current_tools', field_value: 'None' },
    { session_id: 'session-1', field_name: 'ai_experience', field_value: 'Not sure' },
    { session_id: 'session-1', field_name: 'launch_template', field_value: 'authority_product' }
  ];
  const before = structuredClone(rows);
  const summary = canonicalCustomerIntakeSummary(rows, { sessionId: 'session-1' });

  assert.deepEqual(rows, before);
  assert.equal(summary.format, 'numbered_48');
  assert.equal(summary.total, 48);
  assert.equal(summary.known_count, 5);
  assert.equal(summary.unknown_count, 43);
  assert.equal(summary.normalization, 'deterministic_no_inference');
  assert.equal(summary.normalization_style, CUSTOMER_INTAKE_NORMALIZATION_STYLE.version);
  assert.equal(summary.raw_answers_preserved, true);
  assert.equal(CUSTOMER_INTAKE_NORMALIZATION_STYLE.normalization.generative_rewrite, false);
  assert.equal(CUSTOMER_INTAKE_NORMALIZATION_STYLE.unknowns.inference_allowed, false);
  assert.equal(CUSTOMER_INTAKE_NORMALIZATION_STYLE.evidence.raw_layer, 'secondary_disclosure');
  assert.equal(CUSTOMER_INTAKE_NORMALIZATION_STYLE.copy.sales_hype, false);
  assert.equal(CUSTOMER_INTAKE_NORMALIZATION_STYLE.copy.duplicate_copy, false);

  const name = summary.items.find(item => item.key === 'name');
  assert.equal(name.value, 'Robin Ekren');
  assert.equal(name.raw_value, ' Robin Ekren ');
  assert.equal(name.provenance.source_table, 'onboarding_answers');
  assert.equal(name.provenance.session_id, 'session-1');
  assert.deepEqual(name.provenance.raw_values, [' Robin Ekren ']);

  assert.equal(summary.items.find(item => item.key === 'monthly_revenue').status, 'known');
  assert.equal(summary.items.find(item => item.key === 'current_tools').status, 'known');
  assert.equal(summary.items.find(item => item.key === 'ai_experience').status, 'known');
  assert.equal(summary.items.find(item => item.key === 'launch_template').value, 'Digital Estate');
  assert.equal(summary.items.find(item => item.key === 'company').unknown_reason, 'not_captured');

  const lines = summary.text.split('\n');
  assert.equal(lines.length, 48);
  assert.match(lines[0], /^1\. Name: Robin Ekren$/);
  assert.match(lines[47], /^48\. Timezone: Unknown \[not_captured\]$/);
});

test('conflicting duplicate source rows are surfaced as unknown instead of choosing a fact', () => {
  const summary = canonicalCustomerIntakeSummary([
    { session_id: 'session-2', field_name: 'city', field_value: 'Vienna' },
    { session_id: 'session-2', field_name: 'city', field_value: 'Berlin' }
  ]);
  const city = summary.items.find(item => item.key === 'city');
  assert.equal(city.status, 'unknown');
  assert.equal(city.value, null);
  assert.equal(city.unknown_reason, 'conflicting_sources');
  assert.equal(city.provenance.conflicting_sources, true);
  assert.deepEqual(city.provenance.raw_values, ['Vienna', 'Berlin']);
});

test('Customer 360 and pipeline records receive the separate canonical intake summary', () => {
  const data = canonicalLocalScenarioCrm(new Date('2026-08-28T12:00:00.000Z'));
  assert.equal(data.leads.length, 1);
  assert.equal(data.leads[0].intake_summary.total, 48);
  assert.equal(data.leads[0].intake_summary.raw_answers_preserved, true);
  assert.equal(data.opportunities[0].intake_summary, data.leads[0].intake_summary);
});

test('Customer 360 renders one compact escaped 48-answer disclosure with raw differences, unknown flags and provenance', () => {
  const html = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
  const start = html.indexOf('function intakeScalar');
  const end = html.indexOf('function taskDetail', start);
  assert.ok(start > 0 && end > start, 'intake renderer must be present before Customer 360');
  const source = html.slice(start, end);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
  const render = new Function('esc', `${source}; return intakeSummaryPanel;`)(escapeHtml);
  const summary = canonicalCustomerIntakeSummary([
    { session_id: 'session-ui', field_name: 'name', field_value: 'Mia' },
    { session_id: 'session-ui', field_name: 'city', field_value: '<img src=x onerror=alert(1)>' },
    { session_id: 'session-ui', field_name: 'launch_template', field_value: 'authority_product' }
  ]);
  summary.items[0].label = '<script>label</script>';
  summary.items[0].provenance.source_table = '<svg onload=alert(2)>';
  const rendered = render(summary);

  assert.equal((rendered.match(/class="intake-answer"/g) || []).length, 48);
  assert.equal((rendered.match(/class="intake-source"/g) || []).length, 48);
  assert.match(rendered, /^<details class="intake-summary">/);
  assert.doesNotMatch(rendered, /^<details[^>]* open/);
  assert.doesNotMatch(rendered, /<details class="intake-source" open/);
  assert.match(rendered, /48 onboarding answers/);
  assert.match(rendered, /3 captured · 45 unknown/);
  assert.match(rendered, /Raw & provenance/);
  assert.match(rendered, /Raw: authority_product/);
  assert.doesNotMatch(rendered, /Raw: Mia/);
  assert.match(rendered, /Unknown · not_captured/);
  assert.match(rendered, /Source: onboarding_answers\.company/);
  assert.match(rendered, /Session: session-ui/);
  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(rendered, /&lt;script&gt;label&lt;\/script&gt;/);
  assert.match(rendered, /Source: &lt;svg onload=alert\(2\)&gt;\.name/);
  assert.doesNotMatch(rendered, /<script>label<\/script>|<img src=x|<svg onload/);
  assert.match(html, /\$\{intakeSummaryPanel\(entity\.intake_summary\)\}/);
});

test('Founder-QA audit is a prepared $1,997 contract at $0 revenue with no paid state or execution', () => {
  const assignment = prepareFounderQaAuditAssignment();
  assert.deepEqual(assignment, ROBIN_FOUNDER_QA_AUDIT_ASSIGNMENT);
  assert.equal(assignment.state, 'prepared_only');
  assert.equal(assignment.do_not_execute, true);
  assert.equal(assignment.offer.source_offer_key, 'onetime_1997');
  assert.equal(assignment.offer.offer_id, 'audit');
  assert.equal(assignment.offer.list_price, '$1,997 USD');
  assert.equal(assignment.offer.list_price_usd, 1997);
  assert.equal(assignment.accounting.current_growtheko_revenue, 0);
  assert.equal(assignment.accounting.amount_paid, 0);
  assert.equal(assignment.accounting.revenue_recognized, 0);
  assert.equal(assignment.accounting.order_counted, false);
  assert.equal(assignment.accounting.order_count_delta, 0);
  assert.equal(assignment.entitlement.granted, false);
  assert.equal(assignment.entitlement.customer_level_change, false);
  assert.equal(assignment.subject.email, 'robinekrenn@gmail.com');
  assert.equal(assignment.test_access.access_class, 'founder_qa');
  assert.equal(assignment.test_access.principal_email, 'robinekrenn@gmail.com');
  assert.equal(assignment.test_access.commercial_order, false);
  assert.equal(assignment.test_access.order_counted, false);
  assert.equal(assignment.test_access.paid, false);
  assert.equal(assignment.test_access.amount_paid, 0);
  assert.equal(assignment.test_access.revenue_recognized, 0);
  assert.equal(assignment.test_access.target_offer_id, 'audit');
  assert.equal(assignment.test_access.can_unlock_with_current_architecture, true);
  assert.equal(assignment.test_access.authorization_state, 'requires_active_audited_grant');
  assert.equal(FOUNDER_QA_ACCESS_ARCHITECTURE.compatible_now, true);
  assert.equal(assignment.test_access.blockers.length, 0);
  assert.equal(assignment.execution.database_write, false);
  assert.equal(assignment.execution.email_send, false);
  assert.equal(assignment.execution.checkout_created, false);
  assert.equal(assignment.execution.stripe_event, false);
  assert.equal(assignment.execution.paid_entitlement, false);
  assert.equal(assignment.execution.deployment, false);
  assert.equal(assignment.execution.paid_activation_capacity, 0);

  const level = resolveCustomerLevel({
    entity: { id: 'founder-qa-robin', email: 'founder-qa@example.invalid' },
    opportunities: [{
      entity_id: 'founder-qa-robin',
      email: 'founder-qa@example.invalid',
      ...assignment.opportunity_payload_preview
    }]
  });
  assert.equal(level.key, 'lead');
  assert.equal(level.amount, '$0');
});

test('portal architecture exposes a source-backed noncommercial founder authorization path', () => {
  const portal = readFileSync(new URL('./portal/index.html', import.meta.url), 'utf8');
  const accessApi = readFileSync(new URL('./api/founder-qa-access.js', import.meta.url), 'utf8');
  const onboarding = readFileSync(new URL('./api/onboard.js', import.meta.url), 'utf8');
  const billingMigration = readFileSync(new URL('./supabase/migrations/20260827_stripe_billing_ledger.sql', import.meta.url), 'utf8');

  assert.match(portal, /functions\/v1\/portal-auth/);
  assert.match(portal, /const TIER_PHASE_MAP =/);
  assert.match(portal, /FOUNDER_QA_ACCESS_BASE = '\/api\/founder-qa-access'/);
  assert.match(portal, /Founder QA · \$0 paid/);
  assert.match(accessApi, /founder_qa_access_granted/);
  assert.match(accessApi, /founder_qa_access_revoked/);
  assert.match(accessApi, /commercial_order: false/);
  assert.match(accessApi, /revenue_recognized: 0/);
  assert.match(onboarding, /No active paid entitlement matches this onboarding link/);
  assert.match(billingMigration, /check \(status in \('paid', 'manual_review', 'past_due', 'paused', 'canceled', 'refunded', 'disputed'\)\)/);
  assert.doesNotMatch(billingMigration, /founder_qa/);
});

test('Founder-QA contract refuses a non-zero GrowthEko revenue premise', () => {
  assert.throws(
    () => prepareFounderQaAuditAssignment({ currentGrowthEkoRevenue: 1 }),
    /must be prepared against \$0 GrowthEko revenue/
  );
});
