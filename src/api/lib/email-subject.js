import { createHash } from 'node:crypto';

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

export function safeEmailHeader(value, max = 500) {
  return clean(value, max).replace(/[\r\n]+/g, ' ');
}

export function replyEmailSubject(value) {
  const subject = safeEmailHeader(value, 300);
  if (!subject) return 'A message from Nora at GrowthEko';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

const SUBJECTS = Object.freeze({
  connect: ['where should we start?', 'what are you building?', 'one honest starting point'],
  context: ['what matters most right now?', 'what changed recently?', 'the outcome behind this'],
  diagnose: ['let us find the real constraint', 'what is actually blocking this?', 'one thing to diagnose first'],
  clarify: ['one detail before we continue', 'what happened when you tried?', 'the missing piece'],
  recommend: ['the smallest useful move', 'a direction worth checking', 'does this fit what you see?'],
  commit: ['your cleanest next move', 'the scope before you decide', 'everything for the next step'],
  follow_up: ['should i close this?', 'did the priority change?', 'is this still worth solving?'],
  freestyle: ['one honest thought', 'let us make this useful', 'the real thing first'],
  default: ['a quick update', 'one thing for today', 'your next useful step']
});

function stableIndex(value, length) {
  const digest = createHash('sha256').update(String(value || '')).digest();
  return digest.readUInt32BE(0) % length;
}

export function attentionEmailSubject({ name, content, threadSubject, path, stage }) {
  const existing = safeEmailHeader(threadSubject, 300);
  if (existing) return replyEmailSubject(existing);
  const firstName = (safeEmailHeader(name, 120).split(/\s+/)[0] || 'there').toLowerCase();
  const message = clean(content, 1200).toLowerCase();
  let family = clean(stage, 40).toLowerCase();
  if (/\b(?:following up|picking this back up|still relevant)\b/.test(message)) family = 'follow_up';
  else if (/\b(?:next step|move forward|scope|investment)\b/.test(message)) family = family === 'recommend' ? 'recommend' : 'commit';
  else if (clean(path, 40).toLowerCase() === 'freestyle') family = 'freestyle';
  const options = SUBJECTS[family] || (message.includes('?') ? SUBJECTS.clarify : SUBJECTS.default);
  const choice = options[stableIndex(`${firstName}|${family}|${message}`, options.length)];
  return `${firstName}, ${choice}`;
}
