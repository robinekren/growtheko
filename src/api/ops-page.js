import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasOpsSession } from './lib/ops-session.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasOpsSession(req.headers.cookie)) {
    res.statusCode = 302;
    res.setHeader('Location', '/ops-login?next=/crm');
    return res.end();
  }

  const html = readFileSync(join(process.cwd(), 'api', 'ops-template.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
