import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_VALUE = 'ops_568418731c294058ab7a5384d32d9616731215a451ea5161809b0f4e577d31d8';

function hasSession(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map(part => part.trim())
    .some(part => part === `growtheko_ops_session=${SESSION_VALUE}`);
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasSession(req.headers.cookie)) {
    res.statusCode = 302;
    res.setHeader('Location', '/ops-login?next=/ops');
    return res.end();
  }

  const html = readFileSync(join(process.cwd(), 'api', 'ops-template.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
