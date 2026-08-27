import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalCustomerProfile,
  customerProfileFromAnswers,
  customerProfileFromMessageMetadata,
  profileAnswerFromReply
} from './api/lib/customer-profile.js';
import {
  canonicalConversationSource,
  deterministicConversationDraft,
  normalizeConversationScriptRequest
} from './api/lib/conversation-scripts.js';

const template = readFileSync(new URL('./api/ops-template.html', import.meta.url), 'utf8');
const crm = readFileSync(new URL('./api/crm-data.js', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('./onboard/index.html', import.meta.url), 'utf8');

test('customer-provided profile answers are canonicalized without IP inference', () => {
  const profile = customerProfileFromAnswers([
    { field_name: 'date_of_birth', field_value: '2001-04-17' },
    { field_name: 'city', field_value: 'Vienna' },
    { field_name: 'current_job', field_value: 'AI consultant' },
    { field_name: 'timezone', field_value: 'Europe/Vienna' }
  ]);
  assert.deepEqual(profile, {
    birth_date: '2001-04-17',
    city: 'Vienna',
    current_job: 'AI consultant',
    timezone: 'Europe/Vienna',
    source: 'customer_provided'
  });
  assert.equal(canonicalCustomerProfile({ birth_date: 'not-a-date', timezone: 'guess/from-ip' }).birth_date, '');
  assert.doesNotMatch(crm, /geoip|ipapi|ipstack|maxmind/i);
});

test('Inbox shows first name profile context while full name remains searchable', () => {
  assert.match(template, /function profileView\(/);
  assert.match(template, /headline:\[first,age\|\|'age\?',city\|\|'city\?',job\|\|'job\?'\]\.join\('\s*\|\s*'\)/);
  assert.match(template, /customerLocalTime\(timezone\)/);
  assert.match(template, /textMatch\(item\.name,latest\.sender_name,item\.email/);
  assert.match(template, /profile\.headline/);
  assert.match(template, /profile\.first/);
  assert.match(template, /fact\('Birthday',profile\.birthday/);
});

test('profile context is collected in onboarding and in one locked script path', () => {
  assert.match(onboarding, /key: 'city'.*required: true/);
  assert.match(onboarding, /key: 'current_job'.*required: true/);
  assert.match(onboarding, /key: 'date_of_birth'.*type: 'date'/);
  assert.match(onboarding, /It does not affect eligibility or pricing/);
  const source = canonicalConversationSource({
    preferred_name: 'Mia',
    profile_context: { city: 'Vienna', current_job: 'AI consultant', birth_date: '2001-04-17', timezone: 'Europe/Vienna', source: 'customer_provided' }
  });
  const request = normalizeConversationScriptRequest({ path: 'profile_context', stage: 'location', format: 'text' });
  assert.match(deterministicConversationDraft(source, request), /i have you based in vienna/);
  assert.match(template, /profile_context:\{label:'Profile context'/);
});

test('only direct replies to a known profile question become structured profile facts', () => {
  assert.deepEqual(profileAnswerFromReply('location', 'I am based in Vienna.'), { field_name: 'city', field_value: 'Vienna' });
  assert.deepEqual(profileAnswerFromReply('work', 'I work as an AI consultant.'), { field_name: 'current_job', field_value: 'AI consultant' });
  assert.deepEqual(profileAnswerFromReply('birthday', '17.04.2001'), { field_name: 'date_of_birth', field_value: '2001-04-17' });
  assert.equal(profileAnswerFromReply('unknown', 'Vienna'), null);
  const profile = customerProfileFromMessageMetadata([
    { created_at: '2026-01-01', metadata: { profile_context_answer: { field: 'city', value: 'Salzburg' } } },
    { created_at: '2026-02-01', metadata: { profile_context_answer: { field: 'city', value: 'Vienna' } } }
  ]);
  assert.equal(profile.city, 'Vienna');
});
