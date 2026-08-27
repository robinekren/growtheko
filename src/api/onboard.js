// /api/onboard.js — Vercel Serverless Function
// Receives onboarding data from the chat UI and stores it.
// Integrates with Supabase for persistence + Resend for emails.
// v2.1 — Auto-generates portal login password on onboarding completion.

import { createHash, randomBytes } from 'crypto';
import { GROWTHEKO_NOTIFY_EMAIL, GROWTHEKO_PUBLIC_EMAIL, sender } from './_mail-config.js';
import { verifyOnboardingToken } from './lib/onboarding-token.js';
import { resolveOfferKey } from './lib/offer-registry.js';
import { LAUNCH_TEMPLATES, buildLaunchWorkspace, launchArtifactSeeds } from './lib/launch-system.js';

// ========================================
// PASSWORD HELPERS — matches portal-auth Edge Function exactly
// ========================================
const PORTAL_SALT = 'geko_portal_s4lt_2026_x9k2m';

function generateRandomPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(length);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

function hashPasswordSync(password) {
  return createHash('sha256').update(password + PORTAL_SALT).digest('hex');
}

export function normalizeBillingTier(value) {
  return resolveOfferKey(value).offerId || 'legacy_review';
}

export default async function handler(req, res) {
  // CORS
  const allowedOrigins = ['https://growtheko.com', 'https://www.growtheko.com', 'http://localhost:3000', 'http://localhost:4310', 'http://127.0.0.1:4310'];
  const origin = req.headers.origin;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json is required' });
  }

  try {
    const SUPABASE_URL = process.env.GROWTHEKO_SUPABASE_URL;
    const SUPABASE_KEY = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Secure onboarding storage is not configured.' });
    }

    // ========================================
    // VERIFY-ONLY MODE — wizard step 1 email check
    // ========================================
    if (req.body.action === 'verify') {
      const email = (req.body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Email required.' });

      let tokenClaims;
      try {
        tokenClaims = verifySecureOnboardingRequest(req.body, email);
      } catch {
        return res.status(403).json({
          code: 'secure_link_required',
          error: 'Secure onboarding access is required.'
        });
      }

      if (SUPABASE_URL && SUPABASE_KEY) {
        let verifiedOffer;
        if (tokenClaims) {
          verifiedOffer = await verifyPaidOnboardingEntitlement({
            supabaseUrl: SUPABASE_URL,
            supabaseKey: SUPABASE_KEY,
            tokenClaims,
            email
          });
          if (!verifiedOffer) {
            return res.status(403).json({ error: 'No active paid entitlement matches this onboarding link.' });
          }
        } else {
          // Local development compatibility only. Production billing requires
          // BILLING_ONBOARDING_TOKEN_SECRET and never uses email-only access.
          const vRes = await fetch(
            `${SUPABASE_URL}/rest/v1/customers?email=eq.${encodeURIComponent(email)}&select=id,status,tier`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          );
          if (!vRes.ok) throw new Error(`Legacy verification failed (${vRes.status})`);
          const rows = await vRes.json();
          if (!rows || rows.length === 0 || !['paid', 'active'].includes(rows[0].status)) {
            return res.status(403).json({ error: 'No payment found for this email.' });
          }
          verifiedOffer = rows[0].tier;
        }
        // Also fetch application data to pre-fill onboarding (avoid duplicate questions)
        let applicationData = null;
        try {
          const appRes = await fetch(
            `${SUPABASE_URL}/rest/v1/applications?email=eq.${encodeURIComponent(email)}&select=first_name,last_name,website,motivation,profile_type,product_type,revenue_stage,primary_geo_market,additional_markets,company_size,holding_back,goal,urgency,investment_readiness&order=submitted_at.desc&limit=1`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          );
          if (appRes.ok) {
            const appRows = await appRes.json();
            if (appRows && appRows.length > 0) applicationData = appRows[0];
          }
        } catch (e) { console.warn('Application lookup failed:', e); }

        const normalizedOffer = normalizeBillingTier(verifiedOffer);
        if (normalizedOffer === 'legacy_review') {
          return res.status(409).json({ code: 'legacy_entitlement_review', error: 'This entitlement requires manual review before onboarding.' });
        }
        return res.status(200).json({ verified: true, tier: normalizedOffer, applicationData });
      }
      return res.status(503).json({ error: 'Secure onboarding verification is unavailable.' });
    }

    // ========================================
    // FULL ONBOARDING SUBMISSION
    // ========================================
    const { data, completed_at, tier } = req.body;

    if (!data || !data.name || !data.email) {
      return res.status(400).json({ error: 'Missing required fields: name, email' });
    }
    if (
      typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).length > 100 ||
      JSON.stringify(data).length > 100000 ||
      String(data.name).trim().length > 160 ||
      String(data.email).trim().length > 254 ||
      Object.values(data).some(value => typeof value === 'string' && value.length > 5000)
    ) {
      return res.status(413).json({ error: 'Onboarding data exceeds the allowed size.' });
    }
    data.email = String(data.email).trim().toLowerCase();

    let tokenClaims;
    try {
      tokenClaims = verifySecureOnboardingRequest(req.body, data.email);
    } catch {
      return res.status(403).json({
        code: 'secure_link_required',
        error: 'Secure onboarding access is required.'
      });
    }

    // A completed onboarding is not valid unless all required emails can be
    // delivered. Fail before the first database write when mail is not fully
    // configured, so a later retry can safely complete the whole transaction.
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    let systemSender;
    let customerSender;
    try {
      if (!RESEND_API_KEY) throw new Error('Resend is not configured');
      systemSender = sender('GrowthEko System');
      customerSender = sender('GrowthEko');
    } catch {
      return res.status(503).json({ error: 'Secure onboarding delivery is not configured.' });
    }

    // The signed token is stable for the lifetime of this paid onboarding
    // invitation. Hashing it gives us a non-secret, durable idempotency key.
    // The development fallback is deterministic but never used in production.
    const submissionKey = createHash('sha256')
      .update(String(req.body.onboardingToken || `development:${data.email}:${req.body.offerKey || tier || 'audit'}`))
      .digest('hex');

    // ========================================
    // 0. VERIFY PAYMENT — only paid customers can onboard
    // ========================================
    let customerId = null;
    let sessionId = null;
    let generatedPassword = null;
    let verifiedTier = tier || '';

    if (SUPABASE_URL && SUPABASE_KEY) {
      if (tokenClaims) {
        const paidTier = await verifyPaidOnboardingEntitlement({
          supabaseUrl: SUPABASE_URL,
          supabaseKey: SUPABASE_KEY,
          tokenClaims,
          email: data.email
        });
        if (!paidTier) {
          return res.status(403).json({ error: 'Payment entitlement is not active.' });
        }
        verifiedTier = paidTier;
      } else {
        const verifyRes = await fetch(
          `${SUPABASE_URL}/rest/v1/customers?email=eq.${encodeURIComponent(data.email)}&select=id,status,tier`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        if (!verifyRes.ok) throw new Error(`Legacy verification failed (${verifyRes.status})`);
        const existing = await verifyRes.json();
        if (!existing || existing.length === 0 || !['paid', 'active'].includes(existing[0].status)) {
          return res.status(403).json({ error: 'Payment not verified.' });
        }
        verifiedTier = existing[0].tier || tier || '';
      }

      const normalizedVerifiedTier = normalizeBillingTier(verifiedTier);
      if (normalizedVerifiedTier === 'legacy_review') {
        return res.status(409).json({ code: 'legacy_entitlement_review', error: 'This entitlement requires manual review before onboarding.' });
      }

      // A completed submission is immutable. Retrying the same signed link
      // returns the original success without rewriting data or sending email.
      const completedSessions = await supabaseRead(
        SUPABASE_URL,
        SUPABASE_KEY,
        `onboarding_sessions?submission_key=eq.${encodeURIComponent(submissionKey)}&select=id,status,customer_id,tier&limit=1`
      );
      if (completedSessions[0]?.status === 'completed') {
        return res.status(200).json({
          success: true,
          message: 'Onboarding was already completed',
          customer: data.name,
          tier: normalizeBillingTier(completedSessions[0].tier || verifiedTier),
          stored: true,
          replayed: true
        });
      }

      // ========================================
      // 1. STORE IN SUPABASE
      // ========================================

      // Insert the customer once. A concurrent retry must never merge
      // `processing` over a customer that another request already completed.
      const customerRes = await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'customers', 'POST', {
        email: data.email,
        name: data.name,
        tier: normalizedVerifiedTier,
        status: 'active',
        onboarding_status: 'processing',
        nora_status: normalizedVerifiedTier === 'architect' ? 'pending' : 'none',
        last_activity_at: new Date().toISOString()
      }, {
        prefer: 'return=representation',
        onConflict: 'email',
        conflictResolution: 'ignore-duplicates'
      });

      if (customerRes && customerRes.length > 0) {
        customerId = customerRes[0].id;
      }
      if (!customerId) {
        const canonicalCustomers = await supabaseRead(
          SUPABASE_URL,
          SUPABASE_KEY,
          `customers?email=eq.${encodeURIComponent(data.email)}&select=id,onboarding_status&limit=1`
        );
        customerId = canonicalCustomers[0]?.id || null;

        // Refresh non-onboarding profile data only. Deliberately omit
        // onboarding_status so a completed concurrent request cannot be
        // downgraded by this retry.
        if (customerId) {
          await supabaseFetch(
            SUPABASE_URL,
            SUPABASE_KEY,
            `customers?id=eq.${encodeURIComponent(customerId)}`,
            'PATCH',
            {
              name: data.name,
              tier: normalizedVerifiedTier,
              status: 'active',
              nora_status: normalizedVerifiedTier === 'architect' ? 'pending' : 'none',
              last_activity_at: new Date().toISOString()
            },
            { prefer: 'return=minimal' }
          );
        }
      }
      if (!customerId) throw new Error('Customer profile could not be persisted');

      // ========================================
      // 1b. GENERATE PORTAL LOGIN PASSWORD
      // ========================================
      if (customerId && !['membership', 'audit'].includes(normalizedVerifiedTier)) {
        // Only generate if customer doesn't already have a password
        const pwCheckRes = await fetch(
          `${SUPABASE_URL}/rest/v1/customers?id=eq.${customerId}&select=password_hash`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const pwCheck = await pwCheckRes.json();
        const hasPassword = pwCheck && pwCheck.length > 0 && pwCheck[0].password_hash;

        if (!hasPassword) {
          generatedPassword = generateRandomPassword(12);
          const passwordHash = hashPasswordSync(generatedPassword);

          await fetch(
            `${SUPABASE_URL}/rest/v1/customers?id=eq.${customerId}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                password_hash: passwordHash,
                password_changed: false
              })
            }
          );
          console.log(`[ONBOARD] Portal password generated for ${data.email}`);
        }
      }

      // Create the canonical onboarding session. Concurrent retries ignore the
      // duplicate insert and then reuse the already-created processing row.
      if (customerId) {
        const sessionRes = await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'onboarding_sessions', 'POST', {
          customer_id: customerId,
          tier: normalizedVerifiedTier,
          status: 'processing',
          completed_at: null,
          utm_source: data.referral_source || null,
          submission_key: submissionKey
        }, {
          prefer: 'return=representation',
          onConflict: 'submission_key',
          conflictResolution: 'ignore-duplicates'
        });

        if (sessionRes && sessionRes.length > 0) {
          sessionId = sessionRes[0].id;
        }
      }
      if (!sessionId) {
        const canonicalSessions = await supabaseRead(
          SUPABASE_URL,
          SUPABASE_KEY,
          `onboarding_sessions?submission_key=eq.${encodeURIComponent(submissionKey)}&select=id,status,customer_id,tier&limit=1`
        );
        if (canonicalSessions[0]?.status === 'completed') {
          return res.status(200).json({
            success: true,
            message: 'Onboarding was already completed',
            customer: data.name,
            tier: normalizeBillingTier(canonicalSessions[0].tier || verifiedTier),
            stored: true,
            replayed: true
          });
        }
        sessionId = canonicalSessions[0]?.id || null;
      }
      if (!sessionId) throw new Error('Onboarding session could not be persisted');

      // Store all answers
      if (sessionId) {
        const answers = Object.entries(data)
          .filter(([key, value]) => value && key !== 'purchased_tier')
          .map(([field_name, field_value]) => ({
            session_id: sessionId,
            field_name,
            field_value: String(field_value)
          }));

        if (answers.length > 0) {
          await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'onboarding_answers', 'POST', answers, {
            onConflict: 'session_id,field_name'
          });
        }
      }

      // Create blueprint placeholder
      if (customerId && sessionId && ['sprint', 'architect'].includes(normalizedVerifiedTier)) {
        await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'blueprints', 'POST', {
          customer_id: customerId,
          session_id: sessionId,
          tier: normalizedVerifiedTier,
          blueprint_data: data
        }, { onConflict: 'session_id' });
      }

      // Create one canonical Launch Workspace from the same intake. This is an
      // internal draft only: no page is published, no message is sent and no
      // traffic is activated from this database write.
      if (customerId && sessionId) {
        const launch = buildLaunchWorkspace(data);
        const opportunityRows = await supabaseRead(
          SUPABASE_URL,
          SUPABASE_KEY,
          `opportunities?customer_id=eq.${encodeURIComponent(customerId)}&select=id&order=updated_at.desc&limit=1`
        );
        const launchPayload = {
          source_key: `onboarding:${sessionId}`,
          customer_id: customerId,
          onboarding_session_id: sessionId,
          opportunity_id: opportunityRows[0]?.id || null,
          template_key: launch.template_key,
          traffic_mode: launch.traffic_mode,
          primary_cta: launch.primary_cta,
          owns_existing_system: launch.owns_existing_system,
          website_state: launch.website_state,
          domain_mode: launch.domain_mode,
          status: launch.status,
          cta_destination: launch.cta_destination || null,
          domain_value: launch.domain_value || null,
          business_snapshot: launch.business_snapshot,
          offer_snapshot: launch.offer_snapshot,
          launch_config: launch.launch_config,
          review_required: true
        };
        const createdWorkspaces = await supabaseFetch(
          SUPABASE_URL,
          SUPABASE_KEY,
          'launch_workspaces',
          'POST',
          launchPayload,
          { onConflict: 'source_key', conflictResolution: 'ignore-duplicates' }
        );
        let workspaceId = createdWorkspaces?.[0]?.id || null;
        if (!workspaceId) {
          const existingWorkspaces = await supabaseRead(
            SUPABASE_URL,
            SUPABASE_KEY,
            `launch_workspaces?source_key=eq.${encodeURIComponent(`onboarding:${sessionId}`)}&select=id&limit=1`
          );
          workspaceId = existingWorkspaces[0]?.id || null;
        }
        if (!workspaceId) throw new Error('Launch workspace could not be persisted');

        const artifacts = launchArtifactSeeds(data).map(artifact => ({ workspace_id: workspaceId, ...artifact }));
        await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'launch_artifacts', 'POST', artifacts, {
          onConflict: 'workspace_id,artifact_key,version',
          conflictResolution: 'ignore-duplicates'
        });
        await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'ops_audit_events', 'POST', {
          event_key: `launch-workspace:${workspaceId}:created`,
          actor_type: 'system',
          event_type: 'launch_workspace_created',
          entity_type: 'launch_workspace',
          entity_id: workspaceId,
          customer_id: customerId,
          opportunity_id: opportunityRows[0]?.id || null,
          source_table: 'launch_workspaces',
          source_record_id: workspaceId,
          channel: 'onboarding',
          summary: 'Launch Workspace created from verified onboarding',
          metadata: {
            template_key: launch.template_key,
            traffic_mode: launch.traffic_mode,
            primary_cta: launch.primary_cta,
            approval_gates: ['template', 'publish', 'paid_traffic']
          },
          occurred_at: new Date().toISOString()
        }, { onConflict: 'event_key', conflictResolution: 'ignore-duplicates' });
      }
    }

    // Use the entitlement verified against the signed onboarding token.
    const finalTier = normalizeBillingTier(verifiedTier || tier);

    // ========================================
    // 2. SEND NOTIFICATION + FOUNDATION PROMPT TO ROBIN (via Resend)
    // ========================================
    const clientBrief = generateClientBrief(data, finalTier, completed_at);
    const foundationPrompt = generateFoundationPrompt(data, finalTier);

    // Email 1: Client Brief (visual HTML)
    await sendCheckedResendEmail(RESEND_API_KEY, {
          from: systemSender,
          to: [GROWTHEKO_NOTIFY_EMAIL],
          subject: `[CARP] ${finalTier.toUpperCase()} — ${safeEmailHeader(data.name)} — ${safeEmailHeader(data.company || 'No company')} — Onboarding Complete`,
          html: clientBrief
        }, `growtheko-onboard-${submissionKey}-brief`);

    // Email 2: Foundation Prompt (ready to paste into Cowork)
    await sendCheckedResendEmail(RESEND_API_KEY, {
          from: systemSender,
          to: [GROWTHEKO_NOTIFY_EMAIL],
          subject: `[PROMPT] ${finalTier.toUpperCase()} — ${safeEmailHeader(data.name)} — Paste into Cowork`,
          html: `<div style="font-family: monospace; max-width: 800px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #5A8AE6;">Foundation Prompt — ${escapeHtmlServer(data.name)}</h2>
            <p style="color: #888;">Copy everything below and paste into a new Cowork session.</p>
            <hr>
            <pre style="white-space: pre-wrap; background: #f5f5f5; padding: 20px; border-radius: 8px; font-size: 13px; line-height: 1.6;">${escapeHtmlServer(foundationPrompt)}</pre>
          </div>`
        }, `growtheko-onboard-${submissionKey}-prompt`);

    // ========================================
    // 3. SEND WELCOME EMAIL TO CUSTOMER (via Resend)
    // ========================================
    await sendCheckedResendEmail(RESEND_API_KEY, {
          from: customerSender,
          to: [data.email],
          subject: "You're in. Here's what happens next.",
          html: generateWelcomeEmail(data, finalTier, generatedPassword)
        }, `growtheko-onboard-${submissionKey}-welcome`);

    // The session becomes completed only after all required email deliveries
    // are acknowledged. Customer first, session second: a completed session
    // therefore guarantees that the customer profile is already final.
    const completedAt = new Date().toISOString();
    await supabaseFetch(
      SUPABASE_URL,
      SUPABASE_KEY,
      `customers?id=eq.${encodeURIComponent(customerId)}`,
      'PATCH',
      { onboarding_status: 'completed', last_activity_at: completedAt },
      { prefer: 'return=minimal' }
    );
    await supabaseFetch(
      SUPABASE_URL,
      SUPABASE_KEY,
      `onboarding_sessions?submission_key=eq.${encodeURIComponent(submissionKey)}`,
      'PATCH',
      { status: 'completed', completed_at: completedAt },
      { prefer: 'return=minimal' }
    );

    return res.status(200).json({
      success: true,
      message: 'Onboarding data received and stored',
      customer: data.name,
      tier: typeof finalTier !== 'undefined' ? finalTier : tier,
      stored: true,
      replayed: false
    });

  } catch (error) {
    console.error('Onboarding API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function verifySecureOnboardingRequest(body, email) {
  const secret = process.env.BILLING_ONBOARDING_TOKEN_SECRET;
  if (!secret) {
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.GROWTHEKO_INSECURE_DEV_ONBOARDING_ENABLED === 'true'
    ) {
      return null;
    }
    throw new Error('Secure onboarding is not configured');
  }

  return verifyOnboardingToken(
    body?.onboardingToken,
    { email, expectedTier: body?.offerKey },
    secret
  );
}

export async function verifyPaidOnboardingEntitlement({
  supabaseUrl,
  supabaseKey,
  tokenClaims,
  email,
  fetchImpl = fetch
}) {
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const entitlementResponse = await fetchImpl(
    `${supabaseUrl}/rest/v1/stripe_billing_entitlements?stripe_customer_id=eq.${encodeURIComponent(tokenClaims.stripeCustomerId)}&entitlement_key=eq.${encodeURIComponent(tokenClaims.tier)}&select=stripe_customer_id,entitlement_key,email,status`,
    { headers }
  );

  if (entitlementResponse.ok) {
    const rows = await entitlementResponse.json();
    return rows?.length === 1 &&
      rows[0].status === 'paid' &&
      rows[0].email === email
      ? rows[0].entitlement_key
      : null;
  }

  // The live project still has the original customer ledger. Keep signed-link
  // security while supporting that schema until the durable billing migration
  // is installed. Never fall back on email alone: Stripe/customer id, offer,
  // email and paid status must all match the signed claims.
  const entitlementError = await entitlementResponse.json().catch(() => ({}));
  if (entitlementResponse.status !== 404 || entitlementError?.code !== 'PGRST205') {
    throw new Error(`Entitlement verification failed (${entitlementResponse.status})`);
  }

  const customerResponse = await fetchImpl(
    `${supabaseUrl}/rest/v1/customers?stripe_customer_id=eq.${encodeURIComponent(tokenClaims.stripeCustomerId)}&email=eq.${encodeURIComponent(email)}&select=stripe_customer_id,email,status,tier&limit=2`,
    { headers }
  );
  if (!customerResponse.ok) {
    throw new Error(`Customer entitlement verification failed (${customerResponse.status})`);
  }

  const customers = await customerResponse.json();
  const customer = customers?.length === 1 ? customers[0] : null;
  if (
    !customer ||
    !['paid', 'active'].includes(customer.status) ||
    customer.email !== email ||
    customer.stripe_customer_id !== tokenClaims.stripeCustomerId ||
    billingTierKey(customer.tier) !== tokenClaims.tier
  ) {
    return null;
  }
  return tokenClaims.tier;
}

function billingTierKey(value) {
  const tier = String(value || '').trim().toLowerCase();
  if (tier === 'audit' || tier === 'growth' || tier === 'onetime_1997') return 'onetime_1997';
  if (tier === 'membership' || tier === 'monthly_97') return 'monthly_97';
  return null;
}

// ========================================
// HELPER: Supabase REST API fetch
// ========================================
async function supabaseFetch(url, key, table, method, body, options = {}) {
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  if (options.prefer) {
    headers['Prefer'] = options.prefer;
  }
  if (options.onConflict) {
    const resolution = options.conflictResolution === 'ignore-duplicates'
      ? 'ignore-duplicates'
      : 'merge-duplicates';
    headers['Prefer'] = `resolution=${resolution},return=representation`;
  }

  const endpoint = options.onConflict
    ? `${url}/rest/v1/${table}?on_conflict=${options.onConflict}`
    : `${url}/rest/v1/${table}`;

  const response = await fetch(endpoint, {
    method,
    headers,
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText.replace(/[\r\n]+/g, ' ').slice(0, 300);
    throw new Error(`Supabase ${table} write failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }

  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Supabase ${table} returned invalid JSON`);
  }
}

async function supabaseRead(url, key, query) {
  const response = await fetch(`${url}/rest/v1/${query}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText.replace(/[\r\n]+/g, ' ').slice(0, 300);
    throw new Error(`Supabase read failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  if (!responseText) return [];
  try {
    const parsed = JSON.parse(responseText);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch {
    throw new Error('Supabase read returned invalid JSON');
  }
}

async function sendCheckedResendEmail(apiKey, payload, idempotencyKey) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    throw new Error(`Resend onboarding delivery failed (${response.status})`);
  }
  return result.id;
}

// ========================================
// HELPER: Generate Client Brief HTML for Robin
// ========================================
function generateClientBrief(data, tier, completedAt) {
  const launchTemplateName = LAUNCH_TEMPLATES[data.launch_template]?.name || data.launch_template || '—';
  data = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    escapeHtmlServer(Array.isArray(value) ? value.join(', ') : String(value ?? ''))
  ]));
  completedAt = escapeHtmlServer(String(completedAt || new Date().toISOString()));
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="font-size: 24px; border-bottom: 2px solid #5A8AE6; padding-bottom: 10px;">
        New Client Brief — ${(tier || 'secret').toUpperCase()}
      </h1>
      <p style="color: #888; font-size: 14px;">Completed: ${completedAt}</p>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Person</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Name:</td><td><strong>${data.name || '—'}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Company:</td><td>${data.company || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Email:</td><td>${data.email || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Website:</td><td>${data.website || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Country:</td><td>${data.country || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Business Age:</td><td>${data.business_age || '—'}</td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Market</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Market:</td><td><strong>${data.market || '—'}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Sub-Market:</td><td>${data.sub_market || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Niche:</td><td>${data.niche || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Ideal Customer:</td><td>${data.ideal_customer || '—'}</td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Product</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Type:</td><td>${data.product_type || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Description:</td><td>${data.product_description || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Price:</td><td>${data.product_price || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Delivery:</td><td>${data.delivery_method || '—'}</td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Launch Workspace</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Existing system:</td><td>${data.existing_system_owner === 'yes' || (!data.existing_system_owner && data.website) ? 'Yes' : 'No — clean build'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Website:</td><td>${data.website_state || '—'}</td></tr>
        ${data.existing_system_owner === 'yes' || (!data.existing_system_owner && data.website) ? `<tr><td style="padding: 6px 0; color: #888;">System links:</td><td>${data.existing_system_links || data.website || 'not provided'}</td></tr>` : ''}
        <tr><td style="padding: 6px 0; color: #888;">Template:</td><td><strong>${escapeHtmlServer(launchTemplateName)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Primary CTA:</td><td>${data.primary_cta || '—'} → ${data.cta_destination || 'destination missing'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Traffic:</td><td>${data.traffic_mode || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Domain:</td><td>${data.domain_mode || '—'} · ${data.domain_value || 'not selected'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Assets:</td><td>${data.asset_state || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Email:</td><td>${data.email_platform || 'not connected'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Legal:</td><td>${data.legal_links || 'not ready'}</td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Status</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Revenue:</td><td><strong>${data.monthly_revenue || '—'}</strong>/mo</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Customers:</td><td>${data.customer_count || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Acquisition:</td><td>${data.acquisition_channels || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">#1 Problem:</td><td style="color: #e74c3c;"><strong>${data.biggest_problem || '—'}</strong></td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Goals (90 Days)</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">#1 Goal:</td><td>${data.primary_goal || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Revenue Target:</td><td><strong>${data.revenue_target || '—'}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Hours/Week:</td><td>${data.hours_available || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">AI Experience:</td><td>${data.ai_experience || '—'}</td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Tech & Brand</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Tools:</td><td>${data.current_tools || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Email List:</td><td>${data.email_list_size || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Social:</td><td>${data.social_media || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Brand Voice:</td><td>${data.brand_voice || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Entity:</td><td>${data.legal_entity_type || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Support Email:</td><td>${data.support_email || '—'}</td></tr>
      </table>

      <h2 style="font-size: 18px; color: #5A8AE6; margin-top: 24px;">Meta</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888; width: 140px;">Timezone:</td><td>${data.timezone || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Source:</td><td>${data.referral_source || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Notes:</td><td>${data.additional_notes || '—'}</td></tr>
      </table>

      <div style="margin-top: 32px; padding: 16px; background: #f0f4ff; border-radius: 8px; font-size: 14px;">
        <strong>CARP Plan:</strong><br>
        C: Capture complete<br>
        A: Workflows queued — blueprint generating<br>
        R: Traffic channel: ${data.acquisition_channels || 'TBD'}<br>
        P: Revenue target: ${data.revenue_target || 'TBD'}
      </div>

      <p style="margin-top: 24px; font-size: 12px; color: #aaa;">
        Tier: ${tier || 'secret'} | Generated by GrowthEko Onboarding System
      </p>
    </div>
  `;
}

// ========================================
// HELPER: Escape HTML for server-side use
// ========================================
function escapeHtmlServer(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeEmailHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
}

// ========================================
// HELPER: Generate Ultra Foundation Prompt for Robin to paste into Cowork
// v2.0 — Phase 0 Audit, Conditional Logic, 21+ Tasks, Tier-Scope, Execution Rules
// ========================================
function generateFoundationPrompt(data, tier) {
  if (tier === 'audit' || tier === 'membership') {
    return generateLockedOfferPrompt(data, tier);
  }
  if (tier === 'sprint' || tier === 'architect') {
    return generateLaunchWorkspacePrompt(data, tier);
  }

  const tierConfig = {
    secret: { name: 'Legacy entitlement — review required', days: 0 },
    sprint: { name: 'AI System Sprint', days: 60 },
    growth: { name: 'AI System Sprint', days: 60 },
    retainer: { name: 'AI Empire Architect', days: 90 },
    empire: { name: 'AI Empire Architect', days: 90 },
    architect: { name: 'AI Empire Architect', days: 90 }
  };
  const tc = tierConfig[tier] || tierConfig.secret;
  const d = (field, fallback) => data[field] || fallback;
  const revenue = d('monthly_revenue', '$0');
  const isPreRevenue = !revenue || revenue === '$0' || revenue === '0' || revenue === '€0';
  const hasNoProduct = !data.product_type || data.product_type.toLowerCase().includes('nothing');
  const hasNoWebsite = !data.website || data.website.toLowerCase() === 'none' || data.website === '';
  const emailListRaw = parseInt((data.email_list_size || '0').replace(/[^0-9]/g, ''), 10);
  const smallEmailList = isNaN(emailListRaw) || emailListRaw < 100;
  const isAIBeginner = !data.ai_experience || data.ai_experience.toLowerCase().includes('beginner') || data.ai_experience.toLowerCase().includes('none');
  const custCount = d('customer_count', '0');
  const productPrice = d('product_price', 'TBD');

  // Revenue math helper
  const targetRev = d('revenue_target', '€10,000/mo');
  const priceNum = parseInt((productPrice).replace(/[^0-9]/g, ''), 10) || 500;
  const targetNum = parseInt((targetRev).replace(/[^0-9]/g, ''), 10) || 10000;
  const customersNeeded = Math.ceil(targetNum / priceNum);

  // Tier scope labels
  const tierScope = {
    secret: 'Phase 0 + Phase 1 ONLY. Focus on product-market fit and one landing page.',
    growth: 'Phase 0 + Phase 1 + Phase 2 + Phase 3. Full funnel build + traffic strategy. All tasks.',
    empire: 'ALL phases PLUS: custom multi-page website, advanced email automations, paid ads management, team SOPs, quarterly scaling roadmap, exit positioning.'
  };

  let prompt = `# CARP Customer Delivery — ${d('name', 'Customer')} (${tc.name})

You are the autonomous AI delivery system for GrowthEko. You execute the COMPLETE business build for this customer. No questions. No clarifications. No "I need more info." You have EVERYTHING you need below. Just build.

You are Robin Ekren's delivery arm. Robin is the founder of GrowthEko — he sells AI-powered business growth packages. Your job: take the customer data below and BUILD their entire business infrastructure. Every deliverable must be a real, usable, deployable file. No placeholders. No "insert here." Production-ready.

---

## CUSTOMER PROFILE

- **Name:** ${d('name', 'Unknown')}
- **Company:** ${d('company', 'Not set')}
- **Email:** ${d('email', 'Not set')}
- **Website:** ${d('website', 'None')}
- **Country:** ${d('country', 'Not set')}
- **Business Age:** ${d('business_age', 'Not set')}
- **Timezone:** ${d('timezone', 'Not set')}

## MARKET POSITION

- **Primary Market:** ${d('market', 'Not defined')}
- **Sub-Market:** ${d('sub_market', 'Not defined')}
- **Niche:** ${d('niche', 'Not defined')}
- **Blue Ocean:** ${d('blue_ocean', 'Not defined')}
- **Ideal Customer:** ${d('ideal_customer', 'Not defined')}

## PRODUCT

- **Type:** ${d('product_type', 'Not set')}
- **Description:** ${d('product_description', 'Not set')}
- **Price:** ${productPrice}
- **Delivery Method:** ${d('delivery_method', 'Not set')}

## CURRENT STATUS

- **Monthly Revenue:** ${revenue}/mo
- **Customers:** ${custCount}
- **Acquisition Channels:** ${d('acquisition_channels', 'None')}
- **Biggest Problem:** ${d('biggest_problem', 'Not defined')}
- **Email List:** ${d('email_list_size', 'No list')}
- **Social Media:** ${d('social_media', 'None')}

## GOALS

- **Primary Goal:** ${d('primary_goal', 'Not defined')}
- **Revenue Target:** ${targetRev}
- **Hours/Week:** ${d('hours_available', 'Not set')}
- **AI Experience:** ${d('ai_experience', 'Not set')}

## TECH & BRAND

- **Current Tools:** ${d('current_tools', 'None')}
- **Brand Voice:** ${d('brand_voice', 'Not defined')}
- **Legal Entity:** ${d('legal_entity_type', 'Not set')}
- **Support Email:** ${d('support_email', 'Not set')}

---

## TIER: ${tc.name.toUpperCase()} | TIMELINE: ${tc.days} DAYS
## SCOPE: ${tierScope[tier] || tierScope.secret}

---

## PHASE 0: AUDIT & STRATEGY (Day 1)

Before building anything, analyze the customer's current state and create the master strategy.

**Task 0.1 — Current State Audit**
Analyze everything the customer has:
- Website exists? → ${hasNoWebsite ? 'NO — build from scratch.' : `Yes (${data.website}) — audit it: structure, copy, conversion elements, mobile, speed.`}
- Social media audit: content quality, posting frequency, engagement rate, bio optimization (${d('social_media', 'None')})
- Product-market fit assessment: Is the offer clear? Is the price (${productPrice}) justified? Is the ideal customer (${d('ideal_customer', 'undefined')}) well-defined?
- Tech stack gaps: What tools are missing for automation? Current: ${d('current_tools', 'None')}
- Revenue analysis: Current ${revenue}/mo from ${custCount} customers. Target ${targetRev} = needs ~${customersNeeded} customers at ${productPrice}.

**Task 0.2 — Master Strategy Document**
Create a single strategy document (Markdown) that maps out:
- The complete customer journey: Stranger → Follower → Lead → Customer → Repeat Buyer
- Which assets need to be built (in order of priority)
- Revenue math: exact numbers needed at each funnel stage (traffic → leads → sales → ${targetRev})
- ${tc.days}-day timeline with weekly milestones
- Quick wins (things that can generate revenue in Week 1)

Output: \`strategy-master-plan.md\``;

  // Conditional: Pre-revenue Quick Cash Sprint
  if (isPreRevenue) {
    prompt += `

**Task 0.3 — Quick Cash Sprint** ⚡ (PRE-REVENUE DETECTED: ${revenue})
3 ways to generate the first €500 in 7 days using existing skills + audience:
- Method 1: Direct outreach to warm contacts (template + script)
- Method 2: Quick-win service offer (package existing knowledge into a 1-hour paid consultation)
- Method 3: Pre-sell the main offer to existing network (3 DMs/day template)
- Each method: exact steps, copy, timeline, expected result

Output: \`quick-cash-sprint.md\``;
  }

  // Phase 1: Product & Positioning
  prompt += `

---

## PHASE 1: PRODUCT & POSITIONING (Days 2-${Math.round(tc.days * 0.25)})

**Goal:** Make the offer irresistible and the positioning razor-sharp.`;

  // Conditional: No product yet
  if (hasNoProduct) {
    prompt += `

**Task 1.0 — Product Creation from Scratch** ⚡ (NO EXISTING PRODUCT DETECTED)
Identify what to sell based on market (${d('market', 'unknown')}) + skills + ideal customer (${d('ideal_customer', 'unknown')}):
- 3 product ideas ranked by speed-to-revenue
- Recommended product with pricing strategy
- MVP version that can be sold THIS WEEK
- Delivery method that requires minimal setup

Output: \`product-creation.md\``;
  }

  prompt += `

**Task 1.1 — Offer Stack Design**
Create the complete offer stack for ${d('company', 'the business')}:
- Core offer breakdown (what they get)
- Bonuses (at least 3 value-adds that cost nothing to deliver but increase perceived value)
- Price anchoring strategy (show total value vs. ${productPrice} price paid)
- Guarantee: Risk reversal that removes all buyer hesitation
- Urgency mechanism: Why buy NOW not later
- One-sentence pitch that captures the entire transformation
- Blue Ocean differentiator: "${d('blue_ocean', 'unique positioning')}" — weave into EVERYTHING

Output: \`offer-stack.md\`

**Task 1.2 — Product Structure & Delivery System**
Design the complete product delivery:
- Module/session breakdown (what the customer delivers to THEIR clients)
- Timeline for delivery
- Onboarding flow (first 24 hours after purchase)
- Milestones and checkpoints
- Tools needed (based on: ${d('current_tools', 'starting from scratch')})
- Automation opportunities
- Client results tracking (how to measure transformations for testimonials)

Output: \`product-delivery-system.md\`

**Task 1.3 — Brand Positioning & Messaging**
Create the complete brand messaging guide:
- Brand story (personal transformation → framework for content)
- 10 core beliefs (what ${d('company', 'the brand')} stands for)
- Enemy (what they're fighting against)
- Vocabulary guide (words to use, words to avoid, tone examples)
- Bio templates for all platforms
- Elevator pitch (10 seconds, 30 seconds, 60 seconds)

Output: \`brand-messaging-guide.md\`

**Task 1.4 — Landing Page**
Build a complete, deployable landing page (single HTML file) for ${d('company', 'the business')}:
- Hero: Headline + sub-headline + CTA button
- Problem section: 3 pain points of ${d('ideal_customer', 'ideal customers')}
- Solution section: How the ${d('blue_ocean', 'unique approach')} solves it
- How it works: 3-step process
- Social proof section: Testimonial framework (placeholder structure)
- Offer breakdown: Everything included + bonuses + price (${productPrice})
- FAQ: 8-10 common objections answered
- Final CTA with urgency
- Mobile responsive, fast loading
- Brand voice: ${d('brand_voice', 'Professional')}
${hasNoWebsite ? '- THIS IS THE PRIMARY DELIVERABLE — customer has NO website. Build a complete site, not just a landing page.' : ''}

Output: \`landing-page.html\`

**Task 1.5 — Pricing & Upsell Strategy**
Design the complete revenue architecture:
- Core offer: ${productPrice}
- Downsell: Lower ticket entry point for non-buyers
- Upsell: What to offer after they buy (premium tier, 1:1, annual)
- Order bump: Small add-on at checkout
- Lifetime value projection: What's one customer worth over 12 months?

Output: \`pricing-strategy.md\``;

  // Phase 2 (Growth + Empire only)
  if (tier === 'growth' || tier === 'empire') {
    prompt += `

---

## PHASE 2: FUNNEL & AUTOMATION (Days ${Math.round(tc.days * 0.25) + 1}-${Math.round(tc.days * 0.6)})

**Goal:** Build the complete automated customer acquisition machine.

**Task 2.1 — Lead Magnet**
Create a high-converting lead magnet for ${d('ideal_customer', 'ideal customers')}:
- Title: Specific and irresistible for the ${d('niche', 'niche')}
- Format: PDF guide (8-12 pages, designed, not just text)
- Content: Actionable, gives a quick win, naturally leads to the paid offer
- CTA at the end pointing to the main offer
${smallEmailList ? '- ⚡ SMALL LIST DETECTED (' + d('email_list_size', '0') + ') — this is WEEK 1 PRIORITY. Build list before anything else.' : ''}

Output: \`lead-magnet.md\` + design instructions

**Task 2.2 — Opt-in Page**
Build the opt-in/squeeze page (HTML):
- Headline promising the lead magnet transformation
- 3-4 bullet points of what they'll learn
- Email capture form
- Trust elements
- Thank you page with next steps
${smallEmailList ? '- ⚡ PRIORITY: Deploy immediately to start building the email list from ' + d('email_list_size', '0') + ' subscribers.' : ''}

Output: \`opt-in-page.html\` + \`thank-you-page.html\`

**Task 2.3 — Email Welcome Sequence (7 Emails)**
Write the complete email nurture sequence:
- Email 1 (Immediate): Deliver lead magnet + set expectations
- Email 2 (Day 1): Personal story + build connection
- Email 3 (Day 2): Teach something valuable (quick win)
- Email 4 (Day 4): Share a framework/method
- Email 5 (Day 6): Case study / transformation story
- Email 6 (Day 8): Soft pitch — introduce the offer
- Email 7 (Day 10): Hard pitch — urgency + CTA + objection handling
- All emails: Subject lines, preview text, body copy, CTAs
- Voice: ${d('brand_voice', 'Professional')}

Output: \`email-sequence.md\`

**Task 2.4 — Sales Page (Long-Form)**
Create the complete long-form sales page (HTML):
- Pattern interrupt headline
- Story/problem section
- Solution reveal (the ${d('blue_ocean', 'unique approach')})
- Social proof slots
- Offer stack presentation
- Price reveal with anchoring (${productPrice})
- Guarantee section
- FAQ/objection handling
- Urgency/scarcity elements
- Multiple CTA buttons throughout
- Mobile responsive

Output: \`sales-page.html\`

**Task 2.5 — Checkout & Post-Purchase Flow**
Design the complete checkout experience:
- Checkout page copy
- Order bump copy
- Thank you / welcome page after purchase
- Post-purchase email sequence (3 emails)
- Access delivery instructions

Output: \`checkout-flow.md\` + \`post-purchase-emails.md\`

**Task 2.6 — Abandoned Cart Recovery**
Build the abandoned cart system:
- Email 1 (1 hour): Reminder + link back
- Email 2 (24 hours): Address main objection
- Email 3 (48 hours): Urgency + bonus

Output: \`abandoned-cart-sequence.md\`

**Task 2.7 — Webinar/VSL Script**
Create a conversion event script:
- 45-60 min webinar OR 15-20 min VSL structure
- Hook, story, content, pitch flow
- Registration page copy
- Reminder email sequence (3 emails)

Output: \`webinar-script.md\`

**Task 2.8 — Referral & Testimonial System**
Build the referral engine:
- Post-result testimonial request template
- Referral incentive structure
- 7 testimonial collection questions that produce usable quotes
- Before/after documentation guide

Output: \`referral-testimonial-system.md\``;
  }

  // Phase 3 (Growth + Empire only)
  if (tier === 'growth' || tier === 'empire') {
    prompt += `

---

## PHASE 3: TRAFFIC & GROWTH (Days ${Math.round(tc.days * 0.6) + 1}-${tc.days})

**Goal:** Drive targeted traffic and scale what converts.

**Task 3.1 — Content Strategy (30-Day Calendar)**
Create a complete 30-day content calendar:
- Primary platform: ${d('social_media', 'to be determined')}
- Secondary platform: Recommend based on niche
- 30 post ideas with hooks, captions, and CTAs for ${d('niche', 'the niche')}
- Content mix: 40% value, 30% story, 20% engagement, 10% pitch
- Carousel templates (5 frameworks)
- Reel/Short ideas (10 concepts with scripts)
- Hashtag strategy (30 researched hashtags in 3 tiers)
- Best posting times for ${d('timezone', 'the timezone')}
- Content repurposing plan (1 piece → 5 platforms)

Output: \`content-calendar-30-days.md\`

**Task 3.2 — Instagram/Social Growth Playbook**
Specific growth tactics for ${d('social_media', 'primary platform')}:
- Bio optimization (exact bio copy)
- Highlight/pinned content structure
- DM strategy (conversation starters, qualifier questions, close sequence)
- Story strategy (daily framework)
- Engagement strategy (who, how, when)
- Growth roadmap with milestones

Output: \`social-growth-playbook.md\`

**Task 3.3 — Paid Ads Blueprint**
Create the paid advertising strategy:
- Platform recommendation for ${d('niche', 'this niche')}
- 5 ad creatives (copy + image/video direction)
- Targeting: 3 audience sets (interests, lookalike, retargeting)
- Budget plan: Start at €10/day → scale rules
- A/B test plan for first 2 weeks
- Kill criteria (when to stop an ad)

Output: \`paid-ads-blueprint.md\`

**Task 3.4 — SEO & Organic Search**
Build the organic search foundation:
- 20 keyword targets (long-tail, buyer intent) for ${d('niche', 'the niche')}
- 10 blog post outlines optimized for search
- On-page SEO checklist
- Backlink strategy (5 actionable tactics)

Output: \`seo-strategy.md\`

**Task 3.5 — Partnership & Collaboration Strategy**
Identify and plan strategic partnerships:
- 10 potential collaboration partners in ${d('market', 'the market')}
- Outreach templates (DM, email)
- Joint venture ideas
- Podcast guesting pitch template

Output: \`partnership-strategy.md\`

**Task 3.6 — Analytics & Optimization Dashboard**
Create the tracking and optimization system:
- Key metrics to track weekly
- Weekly + monthly review templates
- Conversion rate benchmarks
- Revenue projection model: Path from ${revenue} → ${targetRev}

Output: \`analytics-dashboard.md\``;
  }

  // Conditional: AI Beginner guide
  if (isAIBeginner) {
    prompt += `

---

## BONUS: AI QUICK START GUIDE ⚡ (AI BEGINNER DETECTED)

Create a practical AI guide for ${d('name', 'the customer')}:
- How to use ChatGPT/Claude for daily business tasks
- 10 ready-to-use prompts for: content creation, email writing, customer service, product ideas
- AI workflow for their specific niche (${d('niche', 'unknown')})
- Tool recommendations (free tier first)
- NOT theoretical — every section = copy-paste-use

Output: \`ai-quick-start-guide.md\``;
  }

  // Empire extras
  if (tier === 'empire') {
    prompt += `

---

## EMPIRE EXTRAS (90-Day Scope)

**Task E.1 — Custom Multi-Page Website**
Build a complete website (not just landing page):
- Homepage, About, Services, Blog, Contact
- Full responsive design
- SEO-optimized structure

Output: \`website-homepage.html\` + \`website-about.html\` + \`website-services.html\`

**Task E.2 — Advanced Email Automations**
Build segmentation + behavior-triggered sequences:
- Tag-based segmentation strategy
- Behavior triggers (opened, clicked, purchased, abandoned)
- Re-engagement sequence for cold subscribers

Output: \`advanced-email-automations.md\`

**Task E.3 — Team SOPs**
Create hiring + training documentation:
- VA job description + hiring criteria
- Content VA: daily workflow + tools + templates
- Support VA: response templates + escalation rules
- Onboarding checklist for new team members

Output: \`team-sops.md\`

**Task E.4 — Quarterly Scaling Roadmap**
Map out the next 4 quarters:
- Q1: Foundation + first revenue
- Q2: Scale + team
- Q3: Diversify + automate
- Q4: Exit positioning or Series A prep

Output: \`quarterly-roadmap.md\``;
  }

  // Execution rules + output format (all tiers)
  prompt += `

---

## EXECUTION RULES

1. **EVERY deliverable must be specific to THIS customer.** No generic templates. Use their name (${d('name', 'Customer')}), their niche (${d('niche', 'unknown')}), their brand voice (${d('brand_voice', 'Professional')}), their numbers, their Blue Ocean (${d('blue_ocean', 'unique positioning')}). If it could work for any business, it's not specific enough.

2. **Blue Ocean First.** The differentiator "${d('blue_ocean', 'unique positioning')}" must be woven into EVERY piece of copy, every headline, every email, every ad. This is what makes them different. Use it.

3. **Brand Voice Lock.** All copy must sound like: ${d('brand_voice', 'Professional')}. Read it out loud — if it sounds like a marketing agency wrote it, rewrite it.

4. **Revenue Math in Everything.** Every strategy must connect to the revenue target: ${targetRev}. Show the math. "If we convert 2% of ${Math.ceil(customersNeeded / 0.02)} visitors, that's ${customersNeeded} customers × ${productPrice} = ${targetRev}."

5. **All customer-facing copy in English** (create localized version if customer country is non-English speaking: ${d('country', 'Unknown')}).

6. **File Format:** All text deliverables as Markdown (.md). All web pages as single-file HTML (.html) with inline CSS/JS. All designs as detailed instructions (not image files).

7. **Track progress** with the todo list. Mark each task as you complete it. When ALL tasks are done, create a final \`DELIVERY-SUMMARY.md\` with links to every file created.

8. **No questions. No clarifications. No "should I..." prompts.** You have all the data. Make decisions. Build. Ship.

---

## CONDITIONAL FLAGS (auto-detected from customer data)
${isPreRevenue ? '- ⚡ PRE-REVENUE — Quick Cash Sprint activated (Task 0.3)' : '- ✅ Has revenue: ' + revenue + '/mo'}
${hasNoProduct ? '- ⚡ NO PRODUCT — Product Creation task activated (Task 1.0)' : '- ✅ Has product: ' + d('product_type', 'set')}
${hasNoWebsite ? '- ⚡ NO WEBSITE — Landing page is PRIMARY deliverable' : '- ✅ Has website: ' + data.website}
${smallEmailList ? '- ⚡ SMALL EMAIL LIST (' + d('email_list_size', '0') + ') — List building is Week 1 priority' : '- ✅ Email list: ' + d('email_list_size', 'healthy')}
${isAIBeginner ? '- ⚡ AI BEGINNER — Quick Start AI Guide activated' : '- ✅ AI experienced'}

---

START NOW. Phase 0, Task 0.1. Go.`;

  return prompt;
}

function generateLaunchWorkspacePrompt(data, tier) {
  const d = (field, fallback = 'Not captured') => String(data[field] || fallback).trim();
  const templateName = LAUNCH_TEMPLATES[d('launch_template', 'authority_product')]?.name || LAUNCH_TEMPLATES.authority_product.name;
  const scope = tier === 'architect'
    ? 'Architect: operate the signed systems in sequence. This run completes one launch path before another begins.'
    : 'Sprint: one bounded launch path with one acceptance test. Do not expand the signed System Unit.';
  return `# GrowthEko Launch Workspace — ${d('company', d('name', 'Customer'))}

You are Nora, Robin Ekren's internal operator. Build from verified facts only. Never invent proof, legal text, performance, availability, credentials or customer claims. If a required fact is missing, mark the exact gate and continue every safe internal task. Do not publish, message a customer, connect a domain, activate tracking or spend money from this prompt.

## Scope
${scope}

## Verified input
- Owner: ${d('name')}
- Company: ${d('company')}
- Existing website or funnel owner: ${d('existing_system_owner', data.website ? 'yes' : 'no')}
- Existing system links: ${d('existing_system_links', d('website'))}
- Website state: ${d('website_state', data.website ? 'live' : 'no_website')}
- Existing website/domain: ${d('domain_value', d('website'))}
- Market / niche: ${d('market')} / ${d('niche')}
- Ideal customer: ${d('ideal_customer')}
- Offer: ${d('product_description')} · ${d('product_price')} · ${d('delivery_method')}
- Primary goal: ${d('primary_goal')}
- Page system: ${templateName} (${d('launch_template', 'authority_product')})
- Primary CTA: ${d('primary_cta')} → ${d('cta_destination')}
- Traffic direction: ${d('traffic_mode', 'undecided')}
- Assets: ${d('asset_state', 'needs_support')}
- Email platform: ${d('email_platform', 'none')}
- Existing legal pages: ${d('legal_links')}
- Brand voice: ${d('brand_voice')}
- Exclusions / notes: ${d('launch_notes', 'None captured')}

## One operating sequence
1. Confirm the chosen template direction against the buying path. Stop at Robin's template gate.
2. Create exactly seven versioned artifacts from the same source facts:
   - page-copy.md
   - page-build.html
   - asset-pack.md
   - email-sequence.md
   - tracking-plan.md
   - legal-checklist.md
   - traffic-plan.md
3. Keep two page modes in the same build: Robin Guide and Live Preview. Guide copy speaks in Robin's first person and explains what belongs in each section. Live Preview uses only verified customer facts.
4. Use one dominant CTA. Every secondary link must support that path or be removed.
5. Produce the responsive preview. Test desktop, mobile, keyboard flow, overflow, CTA destinations, forms, error states and reduced motion.
6. Stop at Robin's publish gate with a concise change log and acceptance evidence.
7. After an approved release is actually published, verify analytics consent, event names and end-to-end conversion evidence.
8. If paid or hybrid traffic was selected, prepare a bounded test plan and stop at the separate paid-traffic gate. Never create spend from this prompt.

## Acceptance rules
- Product → funnel → traffic remains one connected path.
- One source of truth; no duplicate intake, portal or CRM module.
- Missing facts remain visibly missing. No placeholders may appear in the live customer-facing mode.
- Email copy uses the same promise, customer language and CTA as the page.
- Legal output is a checklist for qualified customer/legal review, not legal advice.
- Tracking is consent-aware and contains no real test-customer data.
- Every artifact records version, source facts, status and next approval.
- Return only: current status, files created or changed, failed acceptance checks, and the single next action.`;
}

function generateLockedOfferPrompt(data, tier) {
  const d = (field, fallback) => data[field] || fallback;
  const isAudit = tier === 'audit';
  const offerName = isAudit ? 'GrowthEko AI Operator Audit' : 'GrowthEko Operator Membership';
  const outputName = isAudit ? 'AI-OPERATOR-AUDIT.md' : 'MONTH-01-OPERATOR-PLAN.md';

  return `# ${offerName} — ${d('name', 'Customer')}

You are preparing the contracted GrowthEko B2B deliverable. Stay strictly inside marketing, advertising, funnels, digital-product presentation, marketing workflows, and related AI operator support. Do not provide legal, tax, accounting, regulated financial, investment, medical, or licensed management-consulting advice. Do not promise revenue or results.

## Verified customer context
- Company: ${d('company', 'Not provided')}
- Website: ${d('website', 'Not provided')}
- Market / niche: ${d('market', 'Not provided')} / ${d('niche', 'Not provided')}
- Product: ${d('product_description', d('product_type', 'Not provided'))}
- Current revenue: ${d('monthly_revenue', 'Not provided')}
- Acquisition: ${d('acquisition_channels', 'Not provided')}
- Main problem: ${d('biggest_problem', 'Not provided')}
- Goal: ${d('primary_goal', 'Not provided')}
- Current tools: ${d('current_tools', 'Not provided')}
- AI experience: ${d('ai_experience', 'Not provided')}
- Additional notes: ${d('additional_notes', 'None')}

## Required output
Create one file named \`${outputName}\`.
${isAudit ? `It must contain: (1) evidence and assumptions, (2) marketing/funnel bottleneck diagnosis, (3) workflow and AI-readiness review, (4) prioritized operator opportunity map ranked by impact/effort/risk, and (5) a practical 30-day implementation roadmap. This is an audit and roadmap, not implementation work.` : `It must contain: (1) this month's marketing/operator priorities, (2) one clear weekly execution rhythm, (3) relevant workflow/funnel guidance, (4) the exact AI templates or operating checklists the customer should use, and (5) measurable review points for the next monthly cycle. This is ongoing guidance and resources, not a promise of done-for-you implementation.`}

Separate verified facts from assumptions. Flag missing inputs. Be direct, practical, and bounded to the purchased offer.`;
}

// ========================================
// HELPER: Generate Welcome Email for Customer
// ========================================
function generateWelcomeEmail(data, tier, portalPassword) {
  const firstName = escapeHtmlServer((data.name || '').split(' ')[0] || 'there');
  const tierNames = {
    membership: 'GrowthEko Operator Membership',
    audit: 'GrowthEko AI Operator Audit',
    secret: 'Legacy entitlement — review required',
    sprint: 'GrowthEko AI System Sprint',
    retainer: 'GrowthEko AI Empire Architect',
    growth: 'GrowthEko AI System Sprint',
    empire: 'GrowthEko AI Empire Architect',
    onetime_1997: 'GrowthEko AI Operator Audit',
    monthly_97: 'GrowthEko Operator Membership'
  };
  const tierName = tierNames[tier] || 'your program';

  if (tier === 'membership' || tier === 'audit') {
    const nextStep = tier === 'membership'
      ? 'Your first monthly marketing-focused operator priorities and resources will be prepared from the answers you submitted.'
      : 'Your marketing/funnel workflows and AI readiness will be reviewed for the prioritized opportunity map and practical roadmap described in your order.';
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111;line-height:1.6">
        <p style="font-size:13px;letter-spacing:.08em;color:#666">GROWTHEKO</p>
        <h1 style="font-size:26px;margin:18px 0 12px">Onboarding received, ${firstName}.</h1>
        <p>Your onboarding for <strong>${tierName}</strong> is complete.</p>
        <p>${nextStep}</p>
        <p>Billing documents, payment-method updates and subscription controls remain available through Stripe's secure billing flow. This email does not change or expand the service scope in your order.</p>
        <p>Questions: <a href="mailto:${GROWTHEKO_PUBLIC_EMAIL}" style="color:#5A8AE6">${GROWTHEKO_PUBLIC_EMAIL}</a></p>
        <p style="margin-top:28px">Robin Ekren<br>GrowthEko</p>
      </div>`;
  }

  const tierSteps = {
    membership: `
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 1:</strong> Your membership onboarding is complete.</p>
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 2:</strong> Your first monthly marketing-focused operator priorities and resources are being prepared from your answers.</p>
      <p style="font-size: 15px; margin: 0; line-height: 1.6;"><strong>Step 3:</strong> Use your GrowthEko portal for program access and Stripe's billing portal for invoices, payment method, and cancellation.</p>
    `,
    audit: `
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 1:</strong> Your audit onboarding is complete.</p>
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 2:</strong> Your marketing/funnel workflows and AI readiness will be reviewed from the information you supplied.</p>
      <p style="font-size: 15px; margin: 0; line-height: 1.6;"><strong>Step 3:</strong> Your deliverable is the prioritized operator opportunity map and practical implementation roadmap described in your order.</p>
    `,
    secret: `
      <p style="font-size: 15px; margin: 0; line-height: 1.6;"><strong>Review required:</strong> This legacy entitlement must be mapped to a current GrowthEko offer before delivery begins.</p>
    `,
    sprint: `
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 1:</strong> Your onboarding is complete.</p>
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 2:</strong> We verify the signed 30-day scope, the single System Unit, dependencies, and acceptance test.</p>
      <p style="font-size: 15px; margin: 0; line-height: 1.6;"><strong>Step 3:</strong> Tasks, updates, files, and support stay inside your <a href="https://growtheko.com/portal" style="color: #8AB4F3; text-decoration: none;">GrowthEko Portal</a>.</p>
    `,
    retainer: `
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 1:</strong> Your onboarding is complete.</p>
      <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;"><strong>Step 2:</strong> We verify the signed 90-day scope, one revenue path, and up to three System Units.</p>
      <p style="font-size: 15px; margin: 0; line-height: 1.6;"><strong>Step 3:</strong> Tasks, reviews, evidence, and support stay inside your <a href="https://growtheko.com/portal" style="color: #8AB4F3; text-decoration: none;">GrowthEko Portal</a>.</p>
    `
  };

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
      <p style="font-size: 16px; line-height: 1.7;">Hey ${firstName},</p>

      <p style="font-size: 16px; line-height: 1.7;">
        Welcome to GrowthEko. Your order and onboarding details have been recorded.
      </p>

      <p style="font-size: 16px; line-height: 1.7;">
        You've been enrolled in <strong>${tierName}</strong>. Here's what happens now:
      </p>

      <div style="background: #f7f8fc; border-radius: 12px; padding: 24px; margin: 24px 0;">
        ${tierSteps[tier] || tierSteps.audit}
      </div>

      ${portalPassword ? `
      <div style="background: #1a1a2e; border-radius: 12px; padding: 24px; margin: 24px 0; color: #fff;">
        <p style="font-size: 14px; color: #8AB4F3; margin: 0 0 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;">Your Growth Portal Access</p>
        <p style="font-size: 15px; margin: 0 0 8px; line-height: 1.6;">Login: <a href="https://growtheko.com/login-portal" style="color: #8AB4F3;">growtheko.com/login-portal</a></p>
        <p style="font-size: 15px; margin: 0 0 8px; line-height: 1.6;">Email: <strong>${data.email}</strong></p>
        <p style="font-size: 15px; margin: 0 0 12px; line-height: 1.6;">Password: <strong style="font-family: monospace; background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px;">${portalPassword}</strong></p>
        <p style="font-size: 12px; margin: 0; color: #888;">You'll be asked to set a new password on first login</p>
      </div>
      ` : ''}

      <p style="font-size: 16px; line-height: 1.7;">
        Your Portal is the single place for tasks, files, calendar, prompts, and support.
      </p>

      <p style="font-size: 16px; line-height: 1.7;">
        All support communication happens in your <a href="https://growtheko.com/portal?tab=chat" style="color: #8AB4F3; text-decoration: none;">GrowthEko Portal</a>.
      </p>

      <p style="font-size: 16px; line-height: 1.7;">Talk soon,<br><strong>Robin</strong></p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="https://growtheko.com/portal?tab=chat" style="display: inline-block; background: #8AB4F3; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Open Support</a>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 12px; color: #aaa;">
        Robin Ekren | GrowthEko | ${GROWTHEKO_PUBLIC_EMAIL}
      </p>
    </div>
  `;
}
