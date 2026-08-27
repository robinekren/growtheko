import { createHash } from 'node:crypto';
import { hasOpsSession, isSameOrigin } from './lib/ops-session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOLUTIONS = new Set(['approved', 'held', 'rejected']);

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) return body;
  try {
    const parsed = JSON.parse(String(body || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sourceId(value) {
  const id = clean(value, 80);
  return UUID.test(id) ? id : null;
}

function decisionKey(taskId) {
  return `ops:${createHash('sha256').update(taskId).digest('hex')}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!hasOpsSession(req.headers?.cookie)) return res.status(401).json({ ok: false, error: 'Session expired.' });
  if (!isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request unavailable.' });

  const body = parseBody(req.body);
  const taskId = clean(body.task_id, 500);
  const status = clean(body.status, 20).toLowerCase();
  const entityType = clean(body.entity_type, 20).toLowerCase();
  const entityId = sourceId(body.entity_id);
  const opportunityId = sourceId(body.opportunity_id);
  if (!taskId || !RESOLUTIONS.has(status) || !entityId || !['customer', 'lead'].includes(entityType)) {
    return res.status(400).json({ ok: false, error: 'Decision source is invalid.' });
  }

  const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!base || !key) return res.status(503).json({ ok: false, error: 'Decision ledger unavailable.' });

  const now = new Date().toISOString();
  const record = {
    decision_key: decisionKey(taskId),
    task_id: taskId,
    customer_id: entityType === 'customer' ? entityId : null,
    application_id: entityType === 'lead' ? entityId : null,
    opportunity_id: opportunityId,
    status,
    gate: clean(body.gate, 500) || 'Verified exception',
    question: clean(body.happened, 1200) || 'Approve this bounded next action?',
    recommendation: clean(body.recommendation, 1200),
    verified_facts: Array.isArray(body.verified_facts)
      ? body.verified_facts.slice(0, 20).map(value => clean(value, 1200)).filter(Boolean)
      : [],
    requested_by: 'nora',
    requested_at: clean(body.requested_at, 80) || now,
    resolution: status === 'approved' ? 'Approved and returned to Nora’s command queue.' : status === 'held' ? 'Held by Robin; no execution authorized.' : 'Rejected by Robin; no execution authorized.',
    resolved_by: 'robin',
    resolved_at: now,
    metadata: {
      priority: clean(body.priority, 10),
      deadline: clean(body.deadline, 80) || null,
      playbook: clean(body.playbook, 100),
      after_confirmation: clean(body.after_confirmation, 1200),
      external_execution_performed: false
    },
    updated_at: now
  };

  try {
    const response = await fetch(`${base}/rest/v1/ops_decisions?on_conflict=decision_key`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(record)
    });
    if (!response.ok) throw new Error(`Decision ledger rejected: ${response.status}`);
    const rows = await response.json();
    return res.status(200).json({ ok: true, decision: Array.isArray(rows) ? rows[0] : null, external_execution_performed: false });
  } catch (error) {
    console.error('ops-decision:', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Decision could not be recorded.' });
  }
}

export { decisionKey as canonicalDecisionKey };
