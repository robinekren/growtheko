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

export function attentionEmailSubject({ name, content, threadSubject }) {
  const existing = safeEmailHeader(threadSubject, 300);
  if (existing) return replyEmailSubject(existing);
  const firstName = (safeEmailHeader(name, 120).split(/\s+/)[0] || 'there').toLowerCase();
  const message = clean(content, 1200).toLowerCase();
  if (/\b(?:following up|picking this back up|still relevant)\b/.test(message)) return `${firstName}, should i close this?`;
  if (/\b(?:next step|move forward)\b/.test(message)) return `${firstName}, your cleanest next move`;
  if (message.includes('?')) return `${firstName}, one thing before we continue`;
  return `${firstName}, a quick update`;
}
