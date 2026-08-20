// =====================================================================
// /api/unsubscribe — One-click unsubscribe endpoint
// Sets playbook_signups.unsubscribed_at = now() for the given signup ID
// Datum: 2026-05-16
// =====================================================================

export default async function handler(req, res) {
  const id = (req.query?.id || '').trim();

  // Allow only POST (RFC 8058) or GET (legacy clients click links)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).send('Invalid unsubscribe link.');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).send('Server not configured');
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/playbook_signups?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':   'application/json',
        'apikey':         SUPABASE_KEY,
        'Authorization':  `Bearer ${SUPABASE_KEY}`,
        'Prefer':         'return=minimal',
      },
      body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
    });

    if (!r.ok) {
      console.error('Unsubscribe update failed:', r.status, await r.text());
      return res.status(500).send('Could not unsubscribe. Reply to the email and I\'ll remove you manually.');
    }
  } catch (e) {
    console.error('Unsubscribe error:', e);
    return res.status(500).send('Server error');
  }

  // Friendly HTML response
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unsubscribed · GrowthEko</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; background:#fff; color:#0a0a0a; max-width:480px; margin:120px auto; padding:0 24px; text-align:center; line-height:1.55; }
h1 { font-family:Georgia, serif; font-size:36px; font-weight:400; margin-bottom:16px; font-style:italic; color:#b08a4a; }
p { color:#6a6a6a; font-size:16px; }
a { color:#0a0a0a; }
</style>
</head>
<body>
<h1>You're out.</h1>
<p>No more emails. The Playbook still works on your computer.</p>
<p style="margin-top:32px;font-size:13px;">If you change your mind, sign up again at <a href="https://growtheko.com/playbook">growtheko.com/playbook</a>.</p>
</body>
</html>`);
}
