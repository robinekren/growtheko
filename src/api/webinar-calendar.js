import { createHash } from 'node:crypto';

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeSessionDate(value) {
  const parsed = new Date(value);
  const now = new Date();
  if (!Number.isNaN(parsed.getTime())) {
    const tooOld = parsed.getTime() < now.getTime() - 24 * 60 * 60 * 1000;
    const tooFar = parsed.getTime() > now.getTime() + 370 * 24 * 60 * 60 * 1000;
    if (!tooOld && !tooFar) return parsed;
  }
  const fallback = new Date();
  const friday = 5;
  const daysUntilFriday = (friday - fallback.getDay() + 7) % 7;
  fallback.setDate(fallback.getDate() + daysUntilFriday);
  fallback.setHours(18, 0, 0, 0);
  if (fallback <= now) fallback.setDate(fallback.getDate() + 7);
  return fallback;
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldLine(line) {
  const chunks = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildIcs(sessionDate) {
  const end = new Date(sessionDate.getTime() + 90 * 60 * 1000);
  const uid = createHash('sha256').update(sessionDate.toISOString()).digest('hex').slice(0, 24);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GrowthEko//AI Growth Training//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@growtheko.com`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(sessionDate)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs('GrowthEko AI Growth Training')}`,
    `DESCRIPTION:${escapeIcs('Free live 90-minute training. The private access details will be sent before the live session.')}`,
    `LOCATION:${escapeIcs('Online')}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs('GrowthEko AI Growth Training starts in 30 minutes.')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionDate = normalizeSessionDate(clean(req.query?.date, 80));
  const body = buildIcs(sessionDate);
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8; method=PUBLISH');
  res.setHeader('Content-Disposition', 'attachment; filename="growtheko-ai-growth-training.ics"');
  res.status(200);
  if (req.method === 'HEAD') return res.end();
  return res.send(body);
}
