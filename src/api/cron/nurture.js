// /api/cron/nurture.js — Daily email engine
// 1. Nurture: not booked → follow-up sequence (day 1,3,5,7,14,21,30)
// 2. Reminder: booked call in 24h → prep email
// 3. Reminder: booked call in 1h → "starting soon"
// 4. No-show: call_date passed, no reschedule → follow-up
//
// Called daily by scheduled task or manually via GET/POST

import { GROWTHEKO_PUBLIC_EMAIL, GROWTHEKO_RESEND_FROM } from '../_mail-config.js';

const NURTURE_SCHEDULE = [
  { day: 1, index: 1, subject: "your next step, {name}", type: "nurture" },
  { day: 3, index: 2, subject: "a simple way to move forward", type: "nurture" },
  { day: 5, index: 3, subject: "where are you stuck?", type: "nurture" },
  { day: 7, index: 4, subject: "checking in, {name}", type: "nurture" },
  { day: 14, index: 5, subject: "still useful?", type: "nurture" },
  { day: 21, index: 6, subject: "want help choosing the next step?", type: "nurture" },
  { day: 30, index: 7, subject: "closing the loop", type: "nurture" },
];

function getNurtureHtml(index, firstName, calendlyUrl, communityUrl) {
  const templates = {
    1: `<p>Hey ${firstName},</p>
<p>You applied but haven't booked your Free Clarity Call yet.</p>
<p>Quick question: did you enter the private community yet?</p>
<p>It matters because that is where the next step and context live, so you can decide whether this fits without guessing.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>If anything is unclear, reply directly and tell me where you're stuck.</p>
<p>Robin & The EKO Growth Team</p>`,

    2: `<p>Hey ${firstName},</p>
<p>You do not need another pile of information. You only need the next clear step.</p>
<p>Your application is still open. Enter the private community, watch the pinned next step there, then book the call if the direction fits.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>Robin & The EKO Growth Team</p>`,

    3: `<p>Hey ${firstName},</p>
<p>I wanted to check whether the next step is clear or whether something is blocking you.</p>
<p>You can enter the private room for the full context, or reply directly and tell me the bottleneck.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>Robin & The EKO Growth Team</p>`,

    4: `<p>Hey ${firstName},</p>
<p>It has been a week since you applied, so I wanted to check in.</p>
<p>If the timing is wrong, that is completely fine. If you are unsure, reply and tell me what you need to decide.</p>
<p>The private room is available if you want the full context first.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>Robin & The EKO Growth Team</p>`,

    5: `<p>Hey ${firstName},</p>
<p>Two weeks ago you applied to work with us. Is this still useful for you?</p>
<p>If yes, the private next step is below. If no, you can ignore this and I will not treat silence as a yes.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">See The Next Step</a></p>
<p>Robin & The EKO Growth Team</p>`,

    6: `<p>Hey ${firstName},</p>
<p>Do you still want help choosing the next step?</p>
<p>If yes, enter the private community for the context, then book only if the direction fits.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">See The Next Step</a></p>
<p>You can also reply directly with your question.</p>
<p>Robin & The EKO Growth Team</p>`,

    7: `<p>Hey ${firstName},</p>
<p>This is my last email about this.</p>
<p>You applied 30 days ago. I respect that you might have moved on. No hard feelings.</p>
<p>If you still want the context, you can find it here:</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">See The Next Step</a></p>
<p>After this, there will be no more automated follow-ups. You can reply anytime.</p>
<p>All the best,<br/>Robin & The EKO Growth Team</p>`
  };
  return templates[index] || '';
}

function getReminderHtml(type, firstName, calendlyUrl, callDate) {
  const dateStr = new Date(callDate).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });

  if (type === 'reminder_24h') {
    return `<p>Hey ${firstName},</p>
<p>Just a heads up: your Free Clarity Call is <strong>tomorrow</strong>.</p>
<p><strong>${dateStr}</strong></p>
<p>To make the call useful, keep this simple:</p>
<ul>
<li>Know your current monthly revenue. Example: if you are at $0, that is fine.</li>
<li>Bring the one bottleneck you want solved first</li>
</ul>
<p>The team will handle the rest. Show up, be honest about where you are, and we'll map out exactly what to do.</p>
<p>See you tomorrow.</p>
<p>Robin & The EKO Growth Team</p>`;
  }

  if (type === 'reminder_1h') {
    return `<p>Hey ${firstName},</p>
<p>Your Free Clarity Call starts in <strong>1 hour</strong>.</p>
<p><strong>${dateStr}</strong></p>
<p>Make sure you're somewhere quiet with good internet. This is going to be worth your time.</p>
<p>See you soon.</p>
<p>Robin & The EKO Growth Team</p>`;
  }

  if (type === 'no_show') {
    return `<p>Hey ${firstName},</p>
<p>We had your Free Clarity Call scheduled but it looks like you couldn't make it. No worries, life happens.</p>
<p>I'm opening one more slot for you. Book it here and we'll make it work:</p>
<p style="text-align:center;margin:30px 0;"><a href="${calendlyUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Rebook Your Free Clarity Call</a></p>
<p>Robin & The EKO Growth Team</p>`;
  }

  return '';
}

function wrapEmail(bodyHtml) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;line-height:1.6;">
  <div style="padding:40px 30px;">
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;"/>
    <p style="font-size:12px;color:#999;">GrowthEko | growtheko.com<br/>You're receiving this because you applied at growtheko.com/apply<br/><a href="mailto:${GROWTHEKO_PUBLIC_EMAIL}?subject=Unsubscribe" style="color:#999;">Unsubscribe</a></p>
  </div>
</div>`;
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/li>|<\/ul>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendEmail(to, subject, html, messageId) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) { console.log('No RESEND_API_KEY'); return { ok: false, id: null }; }
  const replyTo = String(process.env.GROWTHEKO_INBOUND_EMAIL || '').trim().toLowerCase();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(messageId ? { 'Idempotency-Key': `nurture-${messageId}` } : {})
    },
    body: JSON.stringify({
      from: GROWTHEKO_RESEND_FROM,
      to: [to],
      subject: subject,
      html: wrapEmail(html),
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) ? { reply_to: replyTo } : {})
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Email failed to ${to}:`, err);
    return { ok: false, id: null };
  }
  const payload = await res.json().catch(() => ({}));
  console.log(`Email sent: "${subject}" → ${to}`);
  return { ok: true, id: String(payload.id || '').slice(0, 240) || null };
}

function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function deliverTrackedEmail({ supabaseUrl, supabaseKey, application, subject, html, emailType, emailIndex }) {
  const queuedMetadata = {
    source: 'nurture_cron', channel: 'email', notification_type: emailType,
    email_type: emailType, email_index: emailIndex, subject,
    delivery_email: 'pending', automated: true
  };
  const insert = await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: 'POST',
    headers: serviceHeaders(supabaseKey, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      application_id: application.id,
      sender_type: 'team',
      sender_name: 'Nora',
      content: htmlToText(html),
      message_type: 'text',
      metadata: queuedMetadata
    })
  });
  if (!insert.ok) throw new Error(`Automated email ledger rejected: ${insert.status}`);
  const stored = (await insert.json().catch(() => []))?.[0];
  if (!stored?.id) throw new Error('Automated email ledger returned no source record');

  const delivery = await sendEmail(application.email, subject, html, stored.id);
  const metadata = { ...queuedMetadata, delivery_email: delivery.ok ? 'sent' : 'failed', resend_id: delivery.id };
  const update = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${encodeURIComponent(stored.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders(supabaseKey, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ metadata })
  });
  if (!update.ok) throw new Error(`Automated email delivery state rejected: ${update.status}`);

  const audit = await fetch(`${supabaseUrl}/rest/v1/ops_audit_events?on_conflict=event_key`, {
    method: 'POST',
    headers: serviceHeaders(supabaseKey, { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({
      event_key: `automated-email:${stored.id}`,
      actor_type: 'system', actor_id: 'nurture_cron', event_type: 'customer_email_sent',
      entity_type: 'message', entity_id: stored.id, application_id: application.id,
      source_table: 'messages', source_record_id: stored.id, channel: 'email',
      summary: delivery.ok ? 'Automated customer email sent and recorded' : 'Automated customer email recorded but not delivered',
      metadata: { email_type: emailType, email_index: emailIndex, email_delivery: metadata.delivery_email, automated: true },
      occurred_at: new Date().toISOString()
    })
  });
  if (!audit.ok) throw new Error(`Automated email audit rejected: ${audit.status}`);
  return delivery;
}

async function logEmail(supabaseUrl, supabaseKey, email, emailType, emailIndex) {
  await fetch(`${supabaseUrl}/rest/v1/email_sequences`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ email, email_type: emailType, email_index: emailIndex })
  });
}

async function getAlreadySent(supabaseUrl, supabaseKey, email) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/email_sequences?email=eq.${encodeURIComponent(email)}&select=email_type,email_index`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return [];
  return await res.json();
}

// ═══════════════════════════════════════════
// Calendly Polling — sync bookings to Supabase
// (Replaces webhook — free plan compatible)
// ═══════════════════════════════════════════
async function syncCalendlyBookings(supabaseUrl, supabaseKey) {
  const CALENDLY_TOKEN = process.env.CALENDLY_TOKEN;
  if (!CALENDLY_TOKEN) { console.log('No CALENDLY_TOKEN — skipping sync'); return 0; }

  const userUri = 'https://api.calendly.com/users/5124f5c6-dca0-4b7a-876c-307bdda2c1fa';
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  let synced = 0;

  try {
    // Get all scheduled events from Calendly
    const eventsRes = await fetch(
      `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${thirtyDaysAgo.toISOString()}&max_start_time=${thirtyDaysAhead.toISOString()}&status=active&count=100`,
      { headers: { 'Authorization': `Bearer ${CALENDLY_TOKEN}` } }
    );
    if (!eventsRes.ok) { console.error('Calendly events fetch failed:', eventsRes.status); return 0; }
    const eventsData = await eventsRes.json();

    for (const event of (eventsData.collection || [])) {
      // Get invitees for each event
      const invRes = await fetch(event.uri + '/invitees', {
        headers: { 'Authorization': `Bearer ${CALENDLY_TOKEN}` }
      });
      if (!invRes.ok) continue;
      const invData = await invRes.json();

      for (const invitee of (invData.collection || [])) {
        const email = (invitee.email || '').toLowerCase().trim();
        if (!email) continue;

        // Check if this person is in our applications table and not yet marked as booked
        const checkRes = await fetch(
          `${supabaseUrl}/rest/v1/applications?email=eq.${encodeURIComponent(email)}&booked_at=is.null&select=id`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        if (!checkRes.ok) continue;
        const existing = await checkRes.json();

        if (existing.length > 0) {
          // Update: mark as booked
          await fetch(
            `${supabaseUrl}/rest/v1/applications?email=eq.${encodeURIComponent(email)}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                booked_at: invitee.created_at || now.toISOString(),
                call_date: event.start_time,
                calendly_event_uri: event.uri,
                call_status: invitee.status === 'active' ? 'booked' : invitee.status
              })
            }
          );
          console.log(`Synced booking: ${email} → ${event.start_time}`);
          synced++;
        }
      }
    }

    // Also check for canceled events
    const canceledRes = await fetch(
      `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${thirtyDaysAgo.toISOString()}&max_start_time=${thirtyDaysAhead.toISOString()}&status=canceled&count=100`,
      { headers: { 'Authorization': `Bearer ${CALENDLY_TOKEN}` } }
    );
    if (canceledRes.ok) {
      const canceledData = await canceledRes.json();
      for (const event of (canceledData.collection || [])) {
        const invRes = await fetch(event.uri + '/invitees', {
          headers: { 'Authorization': `Bearer ${CALENDLY_TOKEN}` }
        });
        if (!invRes.ok) continue;
        const invData = await invRes.json();
        for (const invitee of (invData.collection || [])) {
          const email = (invitee.email || '').toLowerCase().trim();
          if (!email) continue;
          // Mark as canceled if currently booked for this event
          await fetch(
            `${supabaseUrl}/rest/v1/applications?email=eq.${encodeURIComponent(email)}&calendly_event_uri=eq.${encodeURIComponent(event.uri)}&call_status=eq.booked`,
            {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ call_status: 'canceled', call_date: null })
            }
          );
        }
      }
    }
  } catch (e) {
    console.error('Calendly sync error:', e);
  }
  return synced;
}

export default async function handler(req, res) {
  const CRON_SECRET = process.env.CRON_SECRET;
  const authorization = req.headers?.authorization || '';
  if (!CRON_SECRET || authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (process.env.GROWTHEKO_CLAIMS_REGISTRY_VERSION !== '2026-08-24.1') {
    return res.status(423).json({ disabled: true, reason: 'Claims registry approval is missing or stale' });
  }

  const SUPABASE_URL = process.env.GROWTHEKO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;

  // Legacy auto-reply is permanently retired. Customer replies are drafted in OPS
  // and can only be sent through the explicit email composer.
  if (req.query.mode === 'nora') {
    return res.status(410).json({ disabled: true, reason: 'Use the reviewed OPS email workflow.' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }

  const now = new Date();
  const results = { calendly_synced: 0, nurture: 0, reminder_24h: 0, reminder_1h: 0, no_show: 0, no_show_rebook: 0, errors: 0 };

  try {
    // ═══════════════════════════════════════════
    // 0. SYNC: Poll Calendly for new bookings
    // ═══════════════════════════════════════════
    results.calendly_synced = await syncCalendlyBookings(SUPABASE_URL, SUPABASE_KEY);

    // ═══════════════════════════════════════════
    // 1. NURTURE: Applied but NOT booked
    // ═══════════════════════════════════════════
    const nurtureRes = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?booked_at=is.null&status=eq.new&select=id,email,first_name,last_name,submitted_at`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (nurtureRes.ok) {
      const unbooked = await nurtureRes.json();

      for (const app of unbooked) {
        const daysSinceApply = Math.floor((now - new Date(app.submitted_at)) / (1000 * 60 * 60 * 24));
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        const sentIndexes = sent.filter(s => s.email_type === 'nurture').map(s => s.email_index);

        // Find the next email to send based on schedule
        for (const step of NURTURE_SCHEDULE) {
          if (daysSinceApply >= step.day && !sentIndexes.includes(step.index)) {
            const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min?name=${encodeURIComponent(app.first_name + ' ' + app.last_name)}&email=${encodeURIComponent(app.email)}`;
            const communityUrl = 'https://www.skool.com/themepages';
            const subject = step.subject.replace('{name}', app.first_name);
            const html = getNurtureHtml(step.index, app.first_name, calendlyUrl, communityUrl);

            if (html) {
              const delivery = await deliverTrackedEmail({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, application: app, subject, html, emailType: 'nurture', emailIndex: step.index });
              if (delivery.ok) {
                await logEmail(SUPABASE_URL, SUPABASE_KEY, app.email, 'nurture', step.index);
                results.nurture++;
              } else {
                results.errors++;
              }
            }
            break; // Only send ONE email per person per run
          }
        }
      }
    }

    // ═══════════════════════════════════════════
    // 2. REMINDER 24H: Call tomorrow
    // ═══════════════════════════════════════════
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowPlus = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const reminder24Res = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.booked&call_date=gte.${tomorrow.toISOString()}&call_date=lte.${tomorrowPlus.toISOString()}&select=id,email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (reminder24Res.ok) {
      const upcoming24 = await reminder24Res.json();
      for (const app of upcoming24) {
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        if (!sent.some(s => s.email_type === 'reminder_24h')) {
          const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min`;
          const html = getReminderHtml('reminder_24h', app.first_name, calendlyUrl, app.call_date);
          const subject = `Tomorrow: Your Free Clarity Call, ${app.first_name}`;
          const delivery = await deliverTrackedEmail({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, application: app, subject, html, emailType: 'reminder_24h', emailIndex: 0 });
          if (delivery.ok) {
            await logEmail(SUPABASE_URL, SUPABASE_KEY, app.email, 'reminder_24h', 0);
            results.reminder_24h++;
          }
        }
      }
    }

    // ═══════════════════════════════════════════
    // 3. REMINDER 1H: Call in ~1 hour
    // ═══════════════════════════════════════════
    const oneHour = new Date(now.getTime() + 55 * 60 * 1000);
    const oneHourPlus = new Date(now.getTime() + 65 * 60 * 1000);

    const reminder1hRes = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.booked&call_date=gte.${oneHour.toISOString()}&call_date=lte.${oneHourPlus.toISOString()}&select=id,email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (reminder1hRes.ok) {
      const upcoming1h = await reminder1hRes.json();
      for (const app of upcoming1h) {
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        if (!sent.some(s => s.email_type === 'reminder_1h')) {
          const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min`;
          const html = getReminderHtml('reminder_1h', app.first_name, calendlyUrl, app.call_date);
          const subject = 'Starting in 1 hour: your Free Clarity Call';
          const delivery = await deliverTrackedEmail({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, application: app, subject, html, emailType: 'reminder_1h', emailIndex: 0 });
          if (delivery.ok) {
            await logEmail(SUPABASE_URL, SUPABASE_KEY, app.email, 'reminder_1h', 0);
            results.reminder_1h++;
          }
        }
      }
    }

    // ═══════════════════════════════════════════
    // 4. NO-SHOW: Call was >2h ago, still "booked"
    // ═══════════════════════════════════════════
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const noShowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.booked&call_date=gte.${oneDayAgo.toISOString()}&call_date=lte.${twoHoursAgo.toISOString()}&select=id,email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (noShowRes.ok) {
      const noShows = await noShowRes.json();
      for (const app of noShows) {
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        if (!sent.some(s => s.email_type === 'no_show')) {
          const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min?name=${encodeURIComponent(app.first_name + ' ' + app.last_name)}&email=${encodeURIComponent(app.email)}`;
          const html = getReminderHtml('no_show', app.first_name, calendlyUrl, app.call_date);
          const subject = `We missed you: let's rebook`;
          const delivery = await deliverTrackedEmail({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, application: app, subject, html, emailType: 'no_show', emailIndex: 0 });
          if (delivery.ok) {
            await logEmail(SUPABASE_URL, SUPABASE_KEY, app.email, 'no_show', 0);
            // Mark as no_show
            await fetch(
              `${SUPABASE_URL}/rest/v1/applications?email=eq.${encodeURIComponent(app.email)}`,
              {
                method: 'PATCH',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ call_status: 'no_show' })
              }
            );
            results.no_show++;
          }
        }
      }
    }

    // ═══════════════════════════════════════════
    // 5. NO-SHOW REBOOK: Follow-up sequence (day 2, 5 after no-show)
    // ═══════════════════════════════════════════
    const noShowRebookRes = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.no_show&select=id,email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (noShowRebookRes.ok) {
      const noShowPeople = await noShowRebookRes.json();
      const rebookSchedule = [
        { day: 2, index: 1, subject: "Still want that roadmap, {name}?" },
        { day: 5, index: 2, subject: "closing the loop on your call" },
      ];

      const rebookTemplates = {
        1: (fn, url) => `<p>Hey ${fn},</p>
<p>Things come up, I get it. But your custom roadmap is still waiting.</p>
<p>If a call is still useful, you can choose a new time. Same format: 30 minutes, we audit your setup, give you the plan, and you decide what to do with it.</p>
<p style="text-align:center;margin:30px 0;"><a href="${url}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Rebook Your Free Clarity Call</a></p>
<p>Robin & The EKO Growth Team</p>`,

        2: (fn, url) => `<p>Hey ${fn},</p>
<p>This is my last message about rebooking.</p>
<p>If you still want the Free Clarity Call and the custom roadmap, you can choose a new time here:</p>
<p style="text-align:center;margin:30px 0;"><a href="${url}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Choose A New Time</a></p>
<p>No hard feelings either way. Wishing you the best.</p>
<p>Robin & The EKO Growth Team</p>`
      };

      for (const app of noShowPeople) {
        if (!app.call_date) continue;
        const daysSinceNoShow = Math.floor((now - new Date(app.call_date)) / (1000 * 60 * 60 * 24));
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        const sentIndexes = sent.filter(s => s.email_type === 'no_show_rebook').map(s => s.email_index);

        for (const step of rebookSchedule) {
          if (daysSinceNoShow >= step.day && !sentIndexes.includes(step.index)) {
            const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min?name=${encodeURIComponent(app.first_name + ' ' + app.last_name)}&email=${encodeURIComponent(app.email)}`;
            const subject = step.subject.replace('{name}', app.first_name);
            const html = rebookTemplates[step.index](app.first_name, calendlyUrl);

            if (html) {
              const delivery = await deliverTrackedEmail({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, application: app, subject, html, emailType: 'no_show_rebook', emailIndex: step.index });
              if (delivery.ok) {
                await logEmail(SUPABASE_URL, SUPABASE_KEY, app.email, 'no_show_rebook', step.index);
                results.no_show_rebook++;
              }
            }
            break;
          }
        }
      }
    }

    console.log('Nurture cron results:', JSON.stringify(results));
    return res.status(200).json({ success: true, results });

  } catch (error) {
    console.error('Nurture cron error:', error);
    return res.status(500).json({ error: error.message });
  }
}
