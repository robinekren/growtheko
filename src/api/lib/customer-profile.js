const PROFILE_ALIASES = Object.freeze({
  birth_date: Object.freeze(['date_of_birth', 'birth_date', 'birthday']),
  city: Object.freeze(['city', 'location_city', 'home_city']),
  current_job: Object.freeze(['current_job', 'occupation', 'job_title', 'profession']),
  timezone: Object.freeze(['timezone_other', 'timezone'])
});

const LEGACY_TIMEZONES = Object.freeze({
  'cet (europe)': 'Europe/Vienna',
  'gmt (uk)': 'Europe/London',
  'est (us east)': 'America/New_York',
  'pst (us west)': 'America/Los_Angeles'
});

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function validBirthDate(value) {
  const candidate = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const [year, month, day] = candidate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  const currentYear = new Date().getUTCFullYear();
  if (year < currentYear - 120 || year > currentYear - 16) return '';
  return candidate;
}

function canonicalTimezone(value) {
  const candidate = clean(value, 100);
  if (!candidate || candidate.toLowerCase() === 'other') return '';
  const legacy = LEGACY_TIMEZONES[candidate.toLowerCase()];
  if (legacy) return legacy;
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return '';
  }
}

function profileHasValues(profile) {
  return Boolean(profile.birth_date || profile.city || profile.current_job || profile.timezone);
}

function replyText(value, max = 240) {
  return clean(value, max).replace(/\s+/g, ' ').replace(/[.!?]+$/g, '').trim();
}

function birthDateFromReply(value) {
  const compact = replyText(value, 120);
  const iso = compact.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validBirthDate(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`);
  const european = compact.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (european) return validBirthDate(`${european[3]}-${european[2].padStart(2, '0')}-${european[1].padStart(2, '0')}`);
  return '';
}

function conciseReply(value, prefixes, max) {
  let result = replyText(value, max);
  for (const prefix of prefixes) result = result.replace(prefix, '').trim();
  if (!result || result.length > max || /https?:\/\//i.test(result) || /[\r\n]/.test(result)) return '';
  return result;
}

function firstAnswer(values, aliases) {
  for (const alias of aliases) {
    const value = clean(values.get(alias), 240);
    if (value) return value;
  }
  return '';
}

export function customerProfileFromAnswers(answers = []) {
  const values = new Map();
  for (const answer of Array.isArray(answers) ? answers : []) {
    const key = clean(answer?.field_name, 80).toLowerCase();
    if (key && !values.has(key)) values.set(key, clean(answer?.field_value, 500));
  }
  return {
    birth_date: validBirthDate(firstAnswer(values, PROFILE_ALIASES.birth_date)),
    city: firstAnswer(values, PROFILE_ALIASES.city),
    current_job: firstAnswer(values, PROFILE_ALIASES.current_job),
    timezone: canonicalTimezone(firstAnswer(values, PROFILE_ALIASES.timezone)),
    source: values.size ? 'customer_provided' : 'not_captured'
  };
}

export function canonicalCustomerProfile(value = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    birth_date: validBirthDate(raw.birth_date || raw.date_of_birth || raw.birthday),
    city: clean(raw.city, 160),
    current_job: clean(raw.current_job || raw.job, 200),
    timezone: canonicalTimezone(raw.timezone),
    source: clean(raw.source, 40) === 'customer_provided' ? 'customer_provided' : 'not_captured'
  };
}

export function mergeCustomerProfiles(...values) {
  const profiles = values.map(canonicalCustomerProfile);
  const merged = {
    birth_date: profiles.find(profile => profile.birth_date)?.birth_date || '',
    city: profiles.find(profile => profile.city)?.city || '',
    current_job: profiles.find(profile => profile.current_job)?.current_job || '',
    timezone: profiles.find(profile => profile.timezone)?.timezone || '',
    source: 'not_captured'
  };
  if (profileHasValues(merged)) merged.source = 'customer_provided';
  return merged;
}

export function profileAnswerFromReply(stage, content) {
  const key = clean(stage, 40).toLowerCase();
  let field = '';
  let value = '';
  if (key === 'location') {
    field = 'city';
    value = conciseReply(content, [/^(?:i am|i'm)\s+based\s+in\s+/i, /^i\s+live\s+in\s+/i, /^based\s+in\s+/i, /^from\s+/i], 100);
  }
  if (key === 'work') {
    field = 'current_job';
    value = conciseReply(content, [/^i\s+(?:currently\s+)?work\s+as\s+(?:an?\s+)?/i, /^(?:i am|i'm)\s+(?:currently\s+)?(?:an?\s+)?/i], 180);
  }
  if (key === 'birthday') {
    field = 'date_of_birth';
    value = birthDateFromReply(content);
  }
  if (key === 'timezone') {
    field = 'timezone';
    value = canonicalTimezone(replyText(content, 100));
  }
  return field && value ? { field_name: field, field_value: value } : null;
}

export function customerProfileFromMessageMetadata(messages = []) {
  const answers = [];
  const ordered = [...(Array.isArray(messages) ? messages : [])]
    .sort((left, right) => new Date(right?.created_at || 0) - new Date(left?.created_at || 0));
  for (const message of ordered) {
    const answer = message?.metadata?.profile_context_answer;
    if (answer && typeof answer === 'object') answers.push({ field_name: answer.field, field_value: answer.value });
  }
  return customerProfileFromAnswers(answers);
}
