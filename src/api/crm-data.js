import { hasOpsSession } from './lib/ops-session.js';

const OFFER_MAP = {
  monthly_97: ['Operator Membership', '$97/mo'],
  membership: ['Operator Membership', '$97/mo'],
  onetime_1997: ['AI Operator Audit', '$1,997'],
  audit: ['AI Operator Audit', '$1,997'],
  roadmap_1997: ['AI Operator Audit', '$1,997'],
  growth: ['AI Operator Audit', '$1,997'],
  done_with_you_4997: ['AI System Sprint', '$4,997'],
  done_with_you_5000: ['AI System Sprint', '$4,997'],
  sprint: ['AI System Sprint', '$4,997'],
  growth_machine: ['AI System Sprint', '$4,997'],
  done_for_you_14997: ['AI Empire Architect', '$14,997'],
  architect: ['AI Empire Architect', '$14,997'],
  empire: ['AI Empire Architect', '$14,997'],
  empire_architect: ['AI Empire Architect', '$14,997']
};

function clean(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

function offer(value) {
  const key = clean(value, 80).toLowerCase();
  const mapped = OFFER_MAP[key];
  if (mapped) return { key, name: mapped[0], price: mapped[1], review_required: false };
  return { key: key || 'unassigned', name: key ? 'Legacy entitlement' : 'Not prescribed', price: 'Review required', review_required: Boolean(key) };
}

function stage(value) {
  const key = clean(value, 80).toLowerCase();
  if (['active', 'paid', 'sold'].includes(key)) return 'Deliver';
  if (['booked', 'qualified'].includes(key)) return 'Commit';
  if (['applied', 'new_lead', 'lead'].includes(key)) return 'Diagnose';
  if (['completed', 'won'].includes(key)) return 'Prove';
  return 'Attention';
}

function headers(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rows(base, key, path) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: headers(key) });
  if (!response.ok) throw new Error(`CRM source unavailable: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function normalizedEmail(value) {
  return clean(value, 320).toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!hasOpsSession(req.headers?.cookie)) return res.status(401).json({ error: 'Session expired.' });

  const base = clean(process.env.GROWTHEKO_SUPABASE_URL, 500).replace(/\/$/, '');
  const key = clean(process.env.GROWTHEKO_SUPABASE_SERVICE_KEY, 10000);
  if (!base || !key) return res.status(503).json({ error: 'CRM source unavailable.' });

  try {
    const [customers, applications, messages] = await Promise.all([
      rows(base, key, 'customers?select=id,email,name,company,tier,status,portal_status,onboarding_status,nora_status,amount_paid,currency,paid_at,last_activity_at,created_at,updated_at&order=created_at.desc&limit=500'),
      rows(base, key, 'applications?select=id,email,first_name,last_name,preferred_name,website,product_type,stage,status,selected_tier,goal,dream_outcome,biggest_challenge,holding_back,submitted_at,call_status,call_date,internal_notes,tags,created_at&order=created_at.desc&limit=500'),
      rows(base, key, 'messages?select=id,application_id,sender_type,sender_name,content,message_type,metadata,read_at,created_at&order=created_at.desc&limit=1000')
    ]);

    const applicationsByEmail = new Map();
    const applicationById = new Map();
    for (const application of applications) {
      const email = normalizedEmail(application.email);
      if (email && !applicationsByEmail.has(email)) applicationsByEmail.set(email, application);
      applicationById.set(String(application.id), application);
    }

    const customerEmails = new Set(customers.map(customer => normalizedEmail(customer.email)).filter(Boolean));
    const people = customers.map(customer => {
      const application = applicationsByEmail.get(normalizedEmail(customer.email)) || null;
      const prescribed = offer(customer.tier || application?.selected_tier);
      return {
        id: clean(customer.id, 140),
        application_id: clean(application?.id, 140),
        name: clean(customer.name || application?.preferred_name || `${application?.first_name || ''} ${application?.last_name || ''}`.trim() || 'Customer', 160),
        email: normalizedEmail(customer.email),
        company: clean(customer.company || application?.website || application?.product_type, 200),
        status: clean(customer.status || 'unknown', 80),
        portal_status: clean(customer.portal_status, 80),
        onboarding_status: clean(customer.onboarding_status, 80),
        nora_status: clean(customer.nora_status, 80),
        amount_paid: Number(customer.amount_paid) || 0,
        currency: clean(customer.currency || 'USD', 10).toUpperCase(),
        paid_at: customer.paid_at || null,
        last_activity_at: customer.last_activity_at || null,
        created_at: customer.created_at || null,
        stage: stage(customer.status || application?.stage),
        offer: prescribed,
        primary_goal: clean(application?.goal || application?.dream_outcome, 1200),
        biggest_bottleneck: clean(application?.biggest_challenge || application?.holding_back, 1200),
        call_booked: ['booked', 'scheduled', 'confirmed'].includes(clean(application?.call_status, 40).toLowerCase()),
        call_time: application?.call_date || null
      };
    });

    const leads = applications.filter(application => !customerEmails.has(normalizedEmail(application.email))).map(application => ({
      id: clean(application.id, 140),
      name: clean(application.preferred_name || `${application.first_name || ''} ${application.last_name || ''}`.trim() || 'Applicant', 160),
      email: normalizedEmail(application.email),
      company: clean(application.website || application.product_type, 200),
      stage: stage(application.stage || application.status),
      raw_stage: clean(application.stage || application.status, 80),
      offer: offer(application.selected_tier),
      primary_goal: clean(application.goal || application.dream_outcome, 1200),
      biggest_bottleneck: clean(application.biggest_challenge || application.holding_back, 1200),
      submitted_at: application.submitted_at || application.created_at || null,
      call_booked: ['booked', 'scheduled', 'confirmed'].includes(clean(application.call_status, 40).toLowerCase()),
      call_time: application.call_date || null
    }));

    const interactions = messages.map(message => {
      const application = applicationById.get(String(message.application_id));
      return {
        id: clean(message.id, 140),
        application_id: clean(message.application_id, 140),
        email: normalizedEmail(application?.email),
        sender_type: clean(message.sender_type, 40),
        sender_name: clean(message.sender_name, 160),
        content: clean(message.content, 30000),
        message_type: clean(message.message_type || 'text', 60),
        metadata: message.metadata && typeof message.metadata === 'object' ? message.metadata : {},
        read_at: message.read_at || null,
        created_at: message.created_at || null
      };
    });

    return res.status(200).json({ generated_at: new Date().toISOString(), people, leads, interactions });
  } catch (error) {
    console.error('crm-data:', error?.message || error);
    return res.status(503).json({ error: 'CRM source unavailable.' });
  }
}

export { offer as canonicalOffer, stage as canonicalStage };
