import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LAUNCH_ARTIFACTS,
  LAUNCH_TEMPLATES,
  buildLaunchWorkspace,
  launchArtifactSeeds,
  launchNextAction
} from './api/lib/launch-system.js';

test('launch system exposes exactly two page families and seven canonical artifacts', () => {
  assert.deepEqual(Object.keys(LAUNCH_TEMPLATES), ['authority_product', 'local_service']);
  assert.deepEqual(LAUNCH_ARTIFACTS.map(item => item.key), [
    'page_copy', 'page_build', 'asset_pack', 'email_sequence',
    'tracking_plan', 'legal_checklist', 'traffic_plan'
  ]);
  assert.equal(new Set(LAUNCH_ARTIFACTS.map(item => item.key)).size, 7);
});

test('onboarding becomes one bounded launch workspace without inventing missing release facts', () => {
  const workspace = buildLaunchWorkspace({
    name: 'Example Owner', company: 'Example Co', product_type: 'Service/Consulting',
    website_state: 'no_website', launch_template: 'local_service', primary_cta: 'whatsapp',
    traffic_mode: 'paid', domain_mode: 'undecided', asset_state: 'needs_support'
  });
  assert.equal(workspace.template_key, 'local_service');
  assert.equal(workspace.website_state, 'no_website');
  assert.equal(workspace.launch_config.gates.template_approval, false);
  assert.equal(workspace.launch_config.gates.publish_approval, false);
  assert.equal(workspace.launch_config.gates.paid_traffic_approval, false);
  assert.equal(workspace.launch_config.gates.cta_destination_ready, false);
  assert.equal(workspace.launch_config.gates.legal_ready, false);
  assert.equal(launchArtifactSeeds(workspace).length, 7);
});

test('launch queue advances from template approval to internal drafting to publish approval', () => {
  const workspace = buildLaunchWorkspace({ launch_template: 'authority_product', primary_cta: 'application', traffic_mode: 'organic' });
  const artifacts = launchArtifactSeeds({ launch_template: 'authority_product' });
  assert.equal(launchNextAction(workspace, artifacts).key, 'launch-template-approval');
  workspace.launch_config.gates.template_approval = true;
  assert.equal(launchNextAction(workspace, artifacts).key, 'launch-build');
  artifacts.forEach(item => { item.status = 'ready_for_review'; });
  assert.equal(launchNextAction(workspace, artifacts).key, 'launch-publish-approval');
});

test('launch storage stays private and approvals remain separate from external execution', () => {
  const migration = readFileSync(new URL('./supabase/migrations/20260828_customer_launch_system.sql', import.meta.url), 'utf8');
  const decisionApi = readFileSync(new URL('./api/ops-decision.js', import.meta.url), 'utf8');
  for (const table of ['launch_workspaces', 'launch_artifacts', 'launch_approvals']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  assert.match(migration, /before update or delete on public\.launch_approvals/);
  assert.match(migration, /launch_approvals is append-only/);
  assert.match(decisionApi, /external_execution_performed: false/);
  assert.match(decisionApi, /No public release or ad spend occurs|no external execution performed/i);
});

test('guided previews and launch intake are part of the existing onboarding and OPS surfaces', () => {
  const preview = readFileSync(new URL('./launch-preview/index.html', import.meta.url), 'utf8');
  const onboarding = readFileSync(new URL('./onboard/index.html', import.meta.url), 'utf8');
  const ops = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
  const portal = readFileSync(new URL('./portal/index.html', import.meta.url), 'utf8');
  assert.match(preview, /Robin guide/);
  assert.match(preview, /does not publish, send, charge or launch ads/);
  assert.match(onboarding, /id: 'launch'/);
  assert.match(onboarding, /Nothing is published and no ads run from onboarding/);
  assert.match(ops, /Launch Workspace/);
  assert.match(portal, /Confirm your Launch Workspace direction/);
  assert.equal((ops.match(/data-view="/g) || []).length, 5);
});
