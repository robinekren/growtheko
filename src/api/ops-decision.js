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

function launchScope(playbook) {
  if (playbook === 'launch-template-approval') return 'template';
  if (playbook === 'launch-publish-approval') return 'publish';
  if (playbook === 'launch-paid-traffic-approval') return 'paid_traffic';
  return null;
}

async function writeLaunchApproval({ base, key, workspaceId, playbook, status, taskId, notes, now }) {
  const scope = launchScope(playbook);
  if (!workspaceId || !scope) return null;
  const decision = status === 'rejected' ? 'changes_requested' : status;
  const approvalKey = `launch:${createHash('sha256').update(`${workspaceId}:${scope}:${taskId}`).digest('hex')}`;
  const approvalResponse = await fetch(`${base}/rest/v1/launch_approvals?on_conflict=approval_key`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ approval_key: approvalKey, workspace_id: workspaceId, scope, decision, notes, decided_by: 'robin', decided_at: now, metadata: { task_id: taskId, external_execution_performed: false } })
  });
  if (!approvalResponse.ok) throw new Error(`Launch approval rejected: ${approvalResponse.status}`);

  if (status === 'approved') {
    const workspaceResponse = await fetch(`${base}/rest/v1/launch_workspaces?id=eq.${workspaceId}&select=id,status,customer_id,opportunity_id,launch_config`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!workspaceResponse.ok) throw new Error(`Launch workspace unavailable: ${workspaceResponse.status}`);
    const workspace = (await workspaceResponse.json())?.[0];
    if (!workspace) throw new Error('Launch workspace not found');
    const launchConfig = workspace.launch_config && typeof workspace.launch_config === 'object' ? workspace.launch_config : {};
    const gates = launchConfig.gates && typeof launchConfig.gates === 'object' ? launchConfig.gates : {};
    const gateKey = scope === 'template' ? 'template_approval' : scope === 'publish' ? 'publish_approval' : 'paid_traffic_approval';
    gates[gateKey] = true;
    const nextStatus = scope === 'template' ? 'template_approved' : scope === 'publish' ? 'approved_to_publish' : workspace.status;
    const updateResponse = await fetch(`${base}/rest/v1/launch_workspaces?id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: nextStatus, launch_config: { ...launchConfig, gates }, updated_at: now })
    });
    if (!updateResponse.ok) throw new Error(`Launch workspace update rejected: ${updateResponse.status}`);
  }

  const launchSourceResponse = await fetch(`${base}/rest/v1/launch_workspaces?id=eq.${workspaceId}&select=customer_id,opportunity_id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!launchSourceResponse.ok) throw new Error(`Launch source unavailable: ${launchSourceResponse.status}`);
  const launchSource = (await launchSourceResponse.json())?.[0] || {};
  const auditResponse = await fetch(`${base}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      event_key: `launch-approval:${approvalKey}:${status}`,
      actor_type: 'robin', event_type: `launch_${scope}_${status}`, entity_type: 'launch_workspace', entity_id: workspaceId,
      customer_id: launchSource.customer_id || null, opportunity_id: launchSource.opportunity_id || null,
      source_table: 'launch_approvals', source_record_id: approvalKey, channel: 'ops',
      summary: `${scope.replaceAll('_', ' ')} ${status}; no external execution performed`,
      metadata: { task_id: taskId, scope, decision, external_execution_performed: false }, occurred_at: now
    })
  });
  if (!auditResponse.ok) throw new Error(`Launch audit rejected: ${auditResponse.status}`);
  return { scope, decision };
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
  const launchWorkspaceId = sourceId(body.launch_workspace_id);
  const playbook = clean(body.playbook, 100);
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
      playbook,
      launch_workspace_id: launchWorkspaceId,
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
    const launchApproval = await writeLaunchApproval({
      base, key, workspaceId: launchWorkspaceId, playbook, status, taskId,
      notes: clean(body.feedback || body.resolution, 1200), now
    });
    return res.status(200).json({ ok: true, decision: Array.isArray(rows) ? rows[0] : null, launch_approval: launchApproval, external_execution_performed: false });
  } catch (error) {
    console.error('ops-decision:', error?.message || error);
    return res.status(503).json({ ok: false, error: 'Decision could not be recorded.' });
  }
}

export { decisionKey as canonicalDecisionKey };
