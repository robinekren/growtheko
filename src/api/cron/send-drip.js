// =====================================================================
// /api/cron/send-drip — daily drip sender
// Stack: Vercel Cron · Node 18 · Supabase · Resend
// Schedule: daily at 09:00 UTC (set in vercel.json)
// Datum: 2026-05-16
// =====================================================================
//
// FLOW:
//   1. Vercel Cron pings GET /api/cron/send-drip (with CRON_SECRET header)
//   2. For each drip (1-4), query playbook_signups in time-window
//   3. Skip users who already received this drip OR unsubscribed
//   4. Send email via Resend, log to playbook_drip_log
//
// REQUIRED ENV VARS:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   RESEND_FROM           — e.g. "Robin Ekren <robin@growtheko.com>"
//   CRON_SECRET           — random string, must match Vercel Cron header
//   GROWTHEKO_DRIP_ENABLED — must be exactly "true"; defaults fail-closed
//
// SUPABASE TABLES NEEDED:
//   playbook_signups (already created via /api/playbook-signup setup)
//   playbook_drip_log (see SETUP.md)
//   playbook_signups.unsubscribed_at column
// =====================================================================

// ----- DRIP CONTENT (source: /01-active/growtheko/email-sequences/playbook-drip/) -----

const DRIPS = {
  1: {
    subject: 'the framework, page by page',
    preheader: 'where to actually start. don\'t read it linearly.',
    html: (fn, id) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0a0a0a;line-height:1.55;font-size:16px;">
<p style="font-size:14px;color:#6a6a6a;margin:0 0 24px;letter-spacing:0.5px;">GROWTHEKO · BY ROBIN EKREN</p>
<p>${esc(fn)},</p>
<p>Quick note before you keep reading the Playbook.</p>
<p>Most operators read it linearly — start at page 1, end at page 40, close it, never act.</p>
<p>Don't.</p>
<p>Here's how to actually use it:</p>
<p style="margin:24px 0;padding:20px 24px;background:#fafafa;border-left:3px solid #b08a4a;"><strong>If you don't have an offer yet</strong> → start at the <em>Niche-to-Customer Mapping</em> section. Narrow the market until you can name one useful customer profile.</p>
<p style="margin:0 0 24px;padding:20px 24px;background:#fafafa;border-left:3px solid #b08a4a;"><strong>If you have an offer but no system</strong> → jump to <em>The Foundation Prompt</em>. Use it to define one outcome, one input and one next action.</p>
<p style="margin:0 0 24px;padding:20px 24px;background:#fafafa;border-left:3px solid #b08a4a;"><strong>If you have a system but it is leaking</strong> → go straight to <em>AI-Native Ops Architecture</em>. Map the handoff where evidence, ownership or the next action becomes unclear.</p>
<p>The CARP framework (5 layers) is the spine. Every other section is a vertebra.</p>
<p>Reply with which section hit hardest — I read everything.</p>
<p style="margin-top:32px;">— Robin</p>
<p style="margin-top:32px;font-size:14px;color:#6a6a6a;">PS: in 2 days I'll send you the "fork" — the single decision that determines whether you stay stuck or build the empire.</p>
${footer(id)}
</div>`,
    text: (fn, id) => `${fn},

Quick note before you keep reading the Playbook.

Most operators read it linearly — start at page 1, end at page 40, close it, never act. Don't.

Here's how to actually use it:

→ If you don't have an offer yet — start at Niche-to-Customer Mapping. Narrow the market until you can name one useful customer profile.

→ If you have an offer but no system — jump to The Foundation Prompt. Use it to define one outcome, one input and one next action.

→ If you have a system but it is leaking — go straight to AI-Native Ops Architecture. Map the handoff where evidence, ownership or the next action becomes unclear.

The CARP framework (5 layers) is the spine. Every other section is a vertebra.

Reply with which section hit hardest.

— Robin

PS: in 2 days I'll send you the "fork" — the single decision that determines whether you stay stuck or build the empire.

${footerText(id)}`,
  },

  2: {
    subject: 'the fork most operators miss',
    preheader: 'the single decision that compounds for years.',
    html: (fn, id) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0a0a0a;line-height:1.55;font-size:16px;">
<p style="font-size:14px;color:#6a6a6a;margin:0 0 24px;letter-spacing:0.5px;">GROWTHEKO · BY ROBIN EKREN</p>
<p>${esc(fn)},</p>
<p>Most owner-operated businesses eventually face the same design choice.</p>
<p>The fork is this:</p>
<p style="margin:24px 0;padding:24px;background:#0a0a0a;color:#fff;border-radius:12px;font-style:italic;font-family:'Instrument Serif',Georgia,serif;font-size:22px;line-height:1.3;">Build a job that pays well.<br/>Or build a system that runs without you.</p>
<p>Sounds obvious. Almost no one picks the right side.</p>
<p>The "job that pays well" feels safer. Adding hours = adding revenue. Linear, predictable, comforting.</p>
<p>The "system that runs without you" feels insane. You stop billing hours. You build infrastructure that has no immediate payoff. For weeks you ship things no client sees.</p>
<p>Here is the operational difference:</p>
<p>In the job-version, delivery depends on the owner's next hour. The owner remains the bottleneck.</p>
<p>In the system-version, one defined outcome has inputs, an owner, a repeatable process and a test. It still requires work, but the work can be measured and improved.</p>
<p>That is what GrowthEko helps operators diagnose and document: the next bounded system worth building.</p>
<p>Reply with which side of the fork you're on right now. I'll tell you honestly what the next move is.</p>
<p style="margin-top:32px;">— Robin</p>
${footer(id)}
</div>`,
    text: (fn, id) => `${fn},

Most owner-operated businesses eventually face the same design choice.

The fork is this:
  Build a job that pays well.
  Or build a system that runs without you.

Sounds obvious. Almost no one picks the right side.

The "job that pays well" feels safer. Adding hours = adding revenue.

The "system that runs without you" feels insane. For weeks you ship things no client sees.

Here is the operational difference:

In the job-version, delivery depends on the owner's next hour. The owner remains the bottleneck.

In the system-version, one defined outcome has inputs, an owner, a repeatable process and a test.

That is what GrowthEko helps operators diagnose and document: the next bounded system worth building.

Reply with which side of the fork you're on right now.

— Robin

${footerText(id)}`,
  },

  3: {
    subject: 'the first real step',
    preheader: 'GrowthEko AI Operator Audit. $1,997 USD one-time — net, plus applicable taxes. Diagnosis, priorities, and a practical implementation roadmap.',
    html: (fn, id) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0a0a0a;line-height:1.55;font-size:16px;">
<p style="font-size:14px;color:#6a6a6a;margin:0 0 24px;letter-spacing:0.5px;">GROWTHEKO · BY ROBIN EKREN</p>
<p>${esc(fn)},</p>
<p>The Playbook gives you the framework.</p>
<p>What it doesn't give you is the daily friction of actually building it.</p>
<p>That is exactly what the GrowthEko AI Operator Audit is for.</p>
<div style="margin:24px 0;padding:24px;background:#fafafa;border:1px solid #e9e9e9;border-radius:12px;">
<strong style="font-family:'Instrument Serif',Georgia,serif;font-size:22px;font-style:italic;color:#0a0a0a;display:block;margin-bottom:12px;">GrowthEko AI Operator Audit — $1,997 USD one-time — net, plus applicable taxes</strong>
<span style="color:#6a6a6a;font-size:14px;display:block;">A focused B2B diagnosis and roadmap for the marketing-related AI operator layer that matters most.</span>
<ul style="margin:16px 0 0;padding:0 0 0 20px;font-size:15px;color:#2a2a2a;line-height:1.7;">
<li>Marketing and funnel bottleneck diagnosis</li>
<li>Workflow and AI-readiness review</li>
<li>Prioritized operator opportunity map</li>
<li>Practical implementation roadmap</li>
</ul>
<p style="margin:20px 0 0;"><a href="https://growtheko.com/start#offers" style="background:#0a0a0a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:500;font-size:14px;">Book the Audit →</a></p>
</div>
<p>It is the cleanest one-time step if you need clarity before implementation.</p>
<p style="font-size:12px;color:#6a6a6a;">Business customers only. Orders from outside Austria require manual business and tax review before acceptance.</p>
<p>If you need an ongoing monthly rhythm instead, I will show you that option in 2 days.</p>
<p style="margin-top:32px;">— Robin</p>
${footer(id)}
</div>`,
    text: (fn, id) => `${fn},

The Playbook gives you the framework. What it doesn't give you is the daily friction of building it.

That is exactly what the GrowthEko AI Operator Audit is for.

GROWTHEKO AI OPERATOR AUDIT — $1,997 USD ONE-TIME — NET, PLUS APPLICABLE TAXES
A focused B2B diagnosis and roadmap for the marketing-related AI operator layer that matters most.

→ Marketing and funnel bottleneck diagnosis
→ Workflow and AI-readiness review
→ Prioritized operator opportunity map
→ Practical implementation roadmap

Book: https://growtheko.com/start#offers

Business customers only. Orders from outside Austria require manual business and tax review before acceptance.

If you need an ongoing monthly rhythm instead, I will show you that option in 2 days.

— Robin

${footerText(id)}`,
  },

  4: {
    subject: 'keep the operator rhythm',
    preheader: 'GrowthEko Operator Membership. $97 USD/month — net, plus applicable taxes. Ongoing marketing-focused AI operator guidance.',
    html: (fn, id) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0a0a0a;line-height:1.55;font-size:16px;">
<p style="font-size:14px;color:#6a6a6a;margin:0 0 24px;letter-spacing:0.5px;">GROWTHEKO · BY ROBIN EKREN</p>
<p>${esc(fn)},</p>
<p>You've had the Playbook for a week. Either you've started building, or you haven't.</p>
<p>If you haven't — that's the thing the Playbook doesn't fix.</p>
<p>Frameworks don't ship. A clear execution rhythm does.</p>
<p>That is what the GrowthEko Operator Membership is built for.</p>
<div style="margin:24px 0;padding:24px;background:#0a0a0a;color:#fff;border-radius:12px;">
<strong style="font-family:'Instrument Serif',Georgia,serif;font-size:26px;font-weight:400;display:block;margin-bottom:8px;">GrowthEko Operator Membership</strong>
<span style="color:rgba(255,255,255,0.7);font-size:14px;display:block;margin-bottom:16px;">$97 USD/month — net, plus applicable taxes · renews monthly until cancelled</span>
<ul style="margin:0;padding:0 0 0 20px;font-size:15px;color:rgba(255,255,255,0.85);line-height:1.7;list-style:none;">
<li>→ Monthly operator playbooks and priorities</li>
<li>→ Marketing workflow and funnel guidance</li>
<li>→ AI execution templates and operating systems</li>
<li>→ Customer portal for invoices and subscription controls</li>
</ul>
<p style="margin:24px 0 0;"><a href="https://growtheko.com/start#offers" style="background:#fff;color:#0a0a0a;padding:14px 28px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:500;font-size:15px;">Start the Membership →</a></p>
<p style="margin:20px 0 0;color:rgba(255,255,255,0.5);font-size:12px;letter-spacing:0.5px;">B2B ONLY · NON-AUSTRIAN ORDERS REQUIRE MANUAL TAX REVIEW</p>
</div>
<p>If you need a focused one-time diagnosis first, book the <a href="https://growtheko.com/start#offers" style="color:#0a0a0a;">GrowthEko AI Operator Audit</a>.</p>
<p>If neither, that's the last you'll hear from me for this sequence. The Playbook stays useful regardless.</p>
<p>Keep building.</p>
<p style="margin-top:32px;">— Robin</p>
${footer(id)}
</div>`,
    text: (fn, id) => `${fn},

You've had the Playbook for a week. Either you've started building, or you haven't.

If you haven't — that's the thing the Playbook doesn't fix.

Frameworks don't ship. A clear execution rhythm does.

That is what the GrowthEko Operator Membership is built for.

GROWTHEKO OPERATOR MEMBERSHIP — $97 USD/MONTH — NET, PLUS APPLICABLE TAXES

→ Monthly operator playbooks and priorities
→ Marketing workflow and funnel guidance
→ AI execution templates and operating systems
→ Customer portal for invoices and subscription controls

Start: https://growtheko.com/start#offers
B2B only · orders from outside Austria require manual business and tax review before acceptance

If you need a focused one-time diagnosis first, book the GrowthEko AI Operator Audit: https://growtheko.com/start#offers

If neither, that's the last you'll hear from me for this sequence. The Playbook stays useful regardless.

Keep building.

— Robin

${footerText(id)}`,
  },
};

function esc(str) {
  return String(str || 'friend').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function footer(signupId) {
  return `<hr style="border:none;border-top:1px solid #e9e9e9;margin:40px 0 24px;" />
<p style="font-size:13px;color:#6a6a6a;"><strong>Robin Ekren</strong> · <a href="https://growtheko.com" style="color:#6a6a6a;">growtheko.com</a> · <a href="https://instagram.com/robinekren" style="color:#6a6a6a;">@robinekren</a></p>
<p style="font-size:11px;color:#aaa;margin-top:16px;"><a href="https://growtheko.com/api/unsubscribe?id=${encodeURIComponent(signupId)}" style="color:#aaa;">Unsubscribe</a></p>`;
}

function footerText(signupId) {
  return `—
Robin Ekren · growtheko.com · @robinekren
Unsubscribe: https://growtheko.com/api/unsubscribe?id=${encodeURIComponent(signupId)}`;
}

// Time-windows in hours since created_at
const DRIP_WINDOWS = {
  1: { min: 20,  max: 28  },   // ~T+1 day
  2: { min: 68,  max: 76  },   // ~T+3 days
  3: { min: 116, max: 124 },   // ~T+5 days
  4: { min: 164, max: 172 },   // ~T+7 days
};

export default async function handler(req, res) {
  if (process.env.GROWTHEKO_DRIP_ENABLED !== 'true') {
    return res.status(200).json({ disabled: true, reason: 'GROWTHEKO_DRIP_ENABLED is not true' });
  }
  if (process.env.GROWTHEKO_CLAIMS_REGISTRY_VERSION !== '2026-08-24.1') {
    return res.status(423).json({ disabled: true, reason: 'Claims registry approval is missing or stale' });
  }

  // Auth — Vercel Cron sends a Bearer header with CRON_SECRET
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;
  const RESEND_FROM  = process.env.RESEND_FROM;

  if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_KEY || !RESEND_FROM) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  const results = { drips: {}, total_sent: 0, errors: [] };

  for (const dripNum of [1, 2, 3, 4]) {
    const { min, max } = DRIP_WINDOWS[dripNum];
    const now = Date.now();
    const fromTs = new Date(now - max * 3600_000).toISOString();
    const toTs   = new Date(now - min * 3600_000).toISOString();

    // Query: signups in window AND no drip-log entry for this drip yet AND not unsubscribed
    const query = new URLSearchParams({
      select: 'id,email,first_name',
      created_at: `gte.${fromTs}`,
      'created_at.lte': toTs,
      unsubscribed_at: 'is.null',
    });

    let signups;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/playbook_signups?created_at=gte.${fromTs}&created_at=lte.${toTs}&unsubscribed_at=is.null&select=id,email,first_name`, {
        headers: {
          'apikey':         SUPABASE_KEY,
          'Authorization':  `Bearer ${SUPABASE_KEY}`,
        },
      });
      if (!r.ok) throw new Error(`Supabase query: ${r.status}`);
      signups = await r.json();
    } catch (e) {
      results.errors.push({ drip: dripNum, err: e.message });
      continue;
    }

    let sent = 0;
    for (const s of signups || []) {
      // Check drip-log idempotency (avoid double-send if cron retries)
      try {
        const checkR = await fetch(`${SUPABASE_URL}/rest/v1/playbook_drip_log?signup_id=eq.${s.id}&drip_number=eq.${dripNum}&select=id&limit=1`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        });
        const existing = await checkR.json();
        if (existing && existing.length > 0) continue; // already sent
      } catch (e) {
        results.errors.push({ drip: dripNum, signup: s.id, err: 'log-check-failed' });
        continue;
      }

      // Send via Resend
      let resendId = null;
      let status = 'sent';
      try {
        const drip = DRIPS[dripNum];
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    RESEND_FROM,
            to:      s.email,
            subject: drip.subject,
            html:    drip.html(s.first_name, s.id),
            text:    drip.text(s.first_name, s.id),
            headers: {
              'List-Unsubscribe': `<https://growtheko.com/api/unsubscribe?id=${s.id}>`,
            },
            tags: [
              { name: 'sequence',    value: 'playbook-drip' },
              { name: 'drip_number', value: String(dripNum) },
            ],
          }),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(`resend ${r.status}: ${txt.slice(0,200)}`);
        }
        const j = await r.json();
        resendId = j?.id || null;
      } catch (e) {
        status = 'failed';
        results.errors.push({ drip: dripNum, signup: s.id, err: e.message });
      }

      // Log
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/playbook_drip_log`, {
          method: 'POST',
          headers: {
            'Content-Type':   'application/json',
            'apikey':         SUPABASE_KEY,
            'Authorization':  `Bearer ${SUPABASE_KEY}`,
            'Prefer':         'return=minimal',
          },
          body: JSON.stringify({
            signup_id:   s.id,
            email:       s.email,
            drip_number: dripNum,
            resend_id:   resendId,
            status,
          }),
        });
        if (status === 'sent') sent++;
      } catch (e) {
        results.errors.push({ drip: dripNum, signup: s.id, err: 'log-insert-failed' });
      }
    }

    results.drips[dripNum] = { eligible: (signups || []).length, sent };
    results.total_sent += sent;
  }

  return res.status(200).json(results);
}
