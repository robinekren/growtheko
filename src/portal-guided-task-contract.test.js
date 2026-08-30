import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const portal = readFileSync(new URL('./portal/index.html', import.meta.url), 'utf8');
const terms = readFileSync(new URL('./terms/index.html', import.meta.url), 'utf8');
const taskContextApi = readFileSync(new URL('./api/portal-task-context.js', import.meta.url), 'utf8');
const portalDecisionsApi = readFileSync(new URL('./api/portal-decisions.js', import.meta.url), 'utf8');
const opsDecisionApi = readFileSync(new URL('./api/ops-decision.js', import.meta.url), 'utf8');

test('portal exposes exactly one active customer task and saves completion before advancing', () => {
  assert.match(portal, /function getActiveTask\(\)/);
  assert.match(portal, /const isCurrent = active\?\.task\?\.id === task\.id/);
  assert.match(portal, /const isLocked = !isCurrent/);
  assert.match(portal, /const result = await syncToggleTask\(taskId, phaseInfo\.id, true\)/);
  assert.match(portal, /if \(result\?\.error\)/);
  assert.match(portal, /currentDetailTaskId = next\?\.task\?\.id \|\| null/);
  assert.doesNotMatch(portal, /onclick="[^"\n]*toggleTask\('/);
});

test('first portal task renders the canonical profile inline with audited editing', () => {
  assert.match(portal, /buildProfileReviewHTML\(\)/);
  assert.match(portal, /Your onboarding profile/);
  assert.match(portal, /Edit any answer inline/);
  assert.match(portal, /action: 'update'/);
  assert.match(taskContextApi, /portal_profile_answer_updated/);
  assert.match(portal, /Everything looks right/);
  assert.match(portal, /action: 'confirm'/);
  assert.match(taskContextApi, /portal_profile_review_confirmed/);
  assert.match(taskContextApi, /deterministic_template_no_model_call/);
  assert.match(portal, /Confirm the saved profile before completing this task/);
  assert.match(portal, /Completion is saved to your delivery history/);
});

test('each task has a personalized AI handoff with success and return rules', () => {
  assert.match(portal, /function buildTaskPrompt\(task, phase\)/);
  assert.match(portal, /VERIFIED ONBOARDING CONTEXT/);
  assert.match(portal, /SUCCESS CRITERIA/);
  assert.match(portal, /Return to the GrowthEko portal and complete this task to open the next one/);
  assert.match(portal, /new Set\(\['date_of_birth', 'tax_id'\]\)/);
  assert.match(portal, /implementation-channel-copy/);
  assert.match(portal, /separate brand and talent bio structures/);
  assert.match(portal, /PROFILE REVISION/);
  assert.match(portal, /Draft updates after every saved answer/);
  assert.match(portal, /Continue in this same AI chat and the same project/);
  assert.match(portal, /AGENTS\.md, PROJECT_CONTEXT\.md, DECISIONS\.md, EVIDENCE\.md and TASKS\.md/);
  assert.match(portal, /GROWTHEKO_DECISION_REQUEST/);
});

test('portal moves each completed task to the top of the next guided task', () => {
  assert.match(portal, /function scrollActivePortalTaskToTop\(\)/);
  assert.match(portal, /selectPhase\(PHASES\.indexOf\(next\.phase\), false\);\s*updateTaskRoute\(next\.phase\.id, next\.task\.id\);\s*scrollActivePortalTaskToTop\(\)/);
  assert.match(portal, /window\.scrollTo\(\{ top, behavior: 'auto' \}\)/);
});

test('member Growth Support follows the Sunday post-webinar slot', () => {
  assert.match(portal, /id: 'growth-support',[\s\S]*?weekday: 0,[\s\S]*?timeMinutes: 21 \* 60,[\s\S]*?durationMinutes: 60/);
});

test('customer decisions are isolated, audited and returned to the task prompt', () => {
  assert.match(portal, /data-portal-panel="decisions"/);
  assert.match(portal, /The saved answer becomes part of the next AI prompt/);
  assert.match(portal, /Decisions are temporarily unavailable/);
  assert.match(portal, /Do not assume approval or make a customer choice/);
  assert.match(portal, /getPortalDecisionPromptText\(task\.id\)/);
  assert.match(portal, /Decision required first/);
  assert.match(portalDecisionsApi, /metadataOf\(row\)\.audience === 'customer'/);
  assert.match(portalDecisionsApi, /portal_customer_decision_resolved/);
  assert.match(portalDecisionsApi, /external_execution_performed: false/);
  assert.match(opsDecisionApi, /request_customer_decision/);
  assert.match(opsDecisionApi, /portal_customer_decision_requested/);
});

test('task flow branches deterministically when operating or offer foundations are missing', () => {
  assert.match(portal, /function getCustomerReadiness\(\)/);
  assert.match(portal, /condition: 'needs_operating_path'/);
  assert.match(portal, /condition: 'needs_offer_foundation'/);
  assert.match(portal, /function getApplicableTasks\(phase\)/);
  assert.match(portal, /Live commerce gate:/);
});

test('Architect receives a downloadable versioned workspace without a fake trained-model claim', () => {
  assert.match(portal, /growtheko-ai-operator-kit\.zip/);
  assert.equal(existsSync(new URL('./portal/assets/growtheko-ai-operator-kit.zip', import.meta.url)), true);
  const readme = readFileSync(new URL('./portal/assets/ai-operator-kit/README.md', import.meta.url), 'utf8');
  assert.match(readme, /project-local instruction and context pack/);
  assert.match(readme, /not model weights/);
});

test('Terms distinguish the voluntary B2B guarantee from mandatory rights', () => {
  assert.match(terms, /Voluntary 14-day B2B delivery guarantee/);
  assert.match(terms, /no more than 50% of the customer-assigned portal tasks/);
  assert.match(terms, /does not restrict any statutory right or remedy/);
  assert.match(terms, /Sending a portal message or correcting a profile answer by itself does not waive/);
});
