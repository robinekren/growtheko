import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasOpsSession } from './lib/ops-session.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasOpsSession(req.headers.cookie)) {
    const requestUrl = new URL(req.url || '/ops', 'https://www.growtheko.com');
    const requestedView = requestUrl.searchParams.get('view');
    const requestedFocus = requestUrl.searchParams.get('focus');
    const view = ['queue', 'customers', 'pipeline', 'inbox', 'decisions'].includes(requestedView) ? requestedView : '';
    const next = view ? `/ops?view=${view}${requestedFocus === 'gate-a' ? '&focus=gate-a' : ''}` : '/ops';
    res.statusCode = 302;
    res.setHeader('Location', `/ops-login?next=${encodeURIComponent(next)}`);
    return res.end();
  }

  const html = readFileSync(join(process.cwd(), 'api', 'ops-template.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
