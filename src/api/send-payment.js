// /api/send-payment.js — Sends payment link email to customer after closer marks as sold
// Called from /closer dashboard when closer clicks "Send Payment Link"

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const SUPABASE_URL = process.env.GROWTHEKO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;

  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });

  const { email, first_name, tier, application_id } = req.body;
  if (!email || !tier) return res.status(400).json({ error: 'Missing email or tier' });

  const TIERS = {
    ai_secret: {
      name: 'AI Secret',
      price: '€1,997',
      link: 'https://www.robinekren.com/secret',
      description: 'Your personalized AI growth plan + 1 automation workflow + 14 days email support.'
    },
    growth_machine: {
      name: 'Growth Machine',
      price: '€4,997',
      link: 'https://www.robinekren.com/growth',
      description: '3 automation workflows + VA setup + Nora AI assistant (30 days) + 30 days Slack support.'
    },
    empire_architect: {
      name: 'Empire Architect',
      price: '€14,997',
      link: 'https://www.robinekren.com/empire',
      description: 'Custom AI agent + full Nora system + 90 days priority support + lifetime community access.'
    }
  };

  const selectedTier = TIERS[tier];
  if (!selectedTier) return res.status(400).json({ error: 'Invalid tier' });

  const name = first_name || 'there';

  try {
    // Send payment email
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Robin Ekren <info@robinekren.com>',
        to: [email],
        subject: `Your ${selectedTier.name} Package Is Ready — Secure Your Spot`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f8fc;font-family:-apple-system,'SF Pro Display','Inter',system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">

    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Times New Roman',Times,serif;font-size:24px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#000;margin:0;">ROBIN EKREN</h1>
    </div>

    <div style="background:#fff;border-radius:16px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">

      <h2 style="font-size:22px;font-weight:600;color:#111;margin:0 0 8px;">Hey ${name} 👋</h2>

      <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">
        Great speaking with you. As discussed, here's everything you need to get started with your <strong>${selectedTier.name}</strong> package.
      </p>

      <div style="background:#f8f9ff;border:1px solid #e8ecf4;border-radius:12px;padding:24px;margin-bottom:24px;">
        <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Your Package</div>
        <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:4px;">${selectedTier.name}</div>
        <div style="font-size:15px;color:#555;margin-bottom:8px;">${selectedTier.description}</div>
        <div style="font-size:28px;font-weight:700;color:#4f7df9;">${selectedTier.price}</div>
      </div>

      <a href="${selectedTier.link}" style="display:block;text-align:center;background:#111;color:#fff;padding:16px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:600;margin-bottom:24px;">
        Complete Your Payment →
      </a>

      <p style="color:#999;font-size:13px;line-height:1.6;margin:0 0 16px;">
        Once your payment is confirmed, you'll receive your onboarding instructions within minutes. Your setup begins immediately.
      </p>

      <p style="color:#999;font-size:13px;line-height:1.6;margin:0;">
        Questions? Simply reply to this email.<br>
        — Robin
      </p>
    </div>

    <div style="text-align:center;margin-top:32px;color:#bbb;font-size:12px;">
      © ${new Date().getFullYear()} Robin Ekren · robinekren.com
    </div>
  </div>
</body>
</html>`
      })
    });

    if (!emailRes.ok) {
      const errData = await emailRes.json();
      console.error('Resend error:', errData);
      return res.status(500).json({ error: 'Email send failed', detail: errData });
    }

    // Update Supabase: mark payment_email_sent_at
    if (SUPABASE_URL && SUPABASE_KEY && application_id) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/applications?id=eq.${application_id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ payment_email_sent_at: new Date().toISOString() })
        }
      );
    }

    return res.status(200).json({ success: true, tier: selectedTier.name });
  } catch (err) {
    console.error('send-payment error:', err);
    return res.status(500).json({ error: err.message });
  }
}
