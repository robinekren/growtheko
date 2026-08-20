// /api/cron/nurture.js — Daily email engine
// 1. Nurture: not booked → follow-up sequence (day 1,3,5,7,14,21,30)
// 2. Reminder: booked call in 24h → prep email
// 3. Reminder: booked call in 1h → "starting soon"
// 4. No-show: call_date passed, no reschedule → follow-up
//
// Called daily by scheduled task or manually via GET/POST

import { GROWTHEKO_PUBLIC_EMAIL, GROWTHEKO_RESEND_FROM } from '../_mail-config.js';

const NURTURE_SCHEDULE = [
  { day: 1, index: 1, subject: "Quick question, {name}", type: "nurture" },
  { day: 3, index: 2, subject: "Most people get this wrong", type: "nurture" },
  { day: 5, index: 3, subject: "This is what's actually costing you money", type: "nurture" },
  { day: 7, index: 4, subject: "{name}, are you still serious?", type: "nurture" },
  { day: 14, index: 5, subject: "2 weeks later: still no call booked", type: "nurture" },
  { day: 21, index: 6, subject: "Last few spots this month", type: "nurture" },
  { day: 30, index: 7, subject: "Final check-in", type: "nurture" },
];

function getNurtureHtml(index, firstName, calendlyUrl, communityUrl) {
  const templates = {
    1: `<p>Hey ${firstName},</p>
<p>You applied but haven't booked your Free Clarity Call yet.</p>
<p>Quick question: did you enter the private community yet?</p>
<p>It matters because that is where the next step and context will live before the momentum goes cold.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>The people who move while the idea is fresh are usually the ones who actually build something.</p>
<p>Robin & The EKO Growth Team</p>`,

    2: `<p>Hey ${firstName},</p>
<p>Most people who want to build an online business start by watching 200 YouTube videos, buying 3 courses, and then doing... nothing.</p>
<p>The ones who actually move take the next step before they overthink it.</p>
<p>Your application is still open. Enter the private community, watch the pinned next step there, then book the call if the direction fits.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>Robin & The EKO Growth Team</p>`,

    3: `<p>Hey ${firstName},</p>
<p>Every day without a system, you're leaving money on the table. Example: actual revenue you could be collecting right now with the right AI workflows in place.</p>
<p>That is why I do not want you sitting in your inbox. Enter the private room while it is still open.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>Robin & The EKO Growth Team</p>`,

    4: `<p>Hey ${firstName},</p>
<p>It's been a week since you applied. I'm not going to pretend I don't notice.</p>
<p>You filled out the application. You said you wanted this. So what's holding you back?</p>
<p>If it's doubt, that is normal. Every founder feels it. The difference is whether you act anyway.</p>
<p>The private room is still open. Enter it, watch the pinned next step, then decide with a clear head.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter The Private Community</a></p>
<p>Robin & The EKO Growth Team</p>`,

    5: `<p>Hey ${firstName},</p>
<p>Two weeks ago you applied to work with us. Since then, nothing happened.</p>
<p>Meanwhile, other applicants are already inside the room, getting context and moving faster.</p>
<p>Your application is still active. But I cannot keep the private next step open forever.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter Before It Closes</a></p>
<p>Robin & The EKO Growth Team</p>`,

    6: `<p>Hey ${firstName},</p>
<p>We're closing out applications for this month soon. Only a few Free Clarity Call spots are left.</p>
<p>If you're still serious about building something real, now is the time.</p>
<p>Enter the private community first. Then book if the direction fits.</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Enter Before The Window Closes</a></p>
<p>Robin & The EKO Growth Team</p>`,

    7: `<p>Hey ${firstName},</p>
<p>This is my last email about this.</p>
<p>You applied 30 days ago. I respect that you might have moved on. No hard feelings.</p>
<p>But if there is still a part of you that wants to build a real AI-powered business, the private community is open one more time:</p>
<p style="text-align:center;margin:30px 0;"><a href="${communityUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Final Access</a></p>
<p>After this, I'll close your application. No follow-ups. If you ever want to come back, just reapply.</p>
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

async function sendEmail(to, subject, html) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) { console.log('No RESEND_API_KEY'); return false; }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: GROWTHEKO_RESEND_FROM,
      to: [to],
      subject: subject,
      html: wrapEmail(html)
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Email failed to ${to}:`, err);
    return false;
  }
  console.log(`Email sent: "${subject}" → ${to}`);
  return true;
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

  const SUPABASE_URL = process.env.GROWTHEKO_SUPABASE_URL;
  const SUPABASE_KEY = process.env.GROWTHEKO_SUPABASE_SERVICE_KEY;

  // ═══ NORA AUTO-REPLY MODE ═══
  if (req.query.mode === 'nora') {
    return await handleNoraReply(req, res, SUPABASE_URL, SUPABASE_KEY);
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
      `${SUPABASE_URL}/rest/v1/applications?booked_at=is.null&status=eq.new&select=email,first_name,last_name,submitted_at`,
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
              const ok = await sendEmail(app.email, subject, html);
              if (ok) {
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
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.booked&call_date=gte.${tomorrow.toISOString()}&call_date=lte.${tomorrowPlus.toISOString()}&select=email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (reminder24Res.ok) {
      const upcoming24 = await reminder24Res.json();
      for (const app of upcoming24) {
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        if (!sent.some(s => s.email_type === 'reminder_24h')) {
          const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min`;
          const html = getReminderHtml('reminder_24h', app.first_name, calendlyUrl, app.call_date);
          const ok = await sendEmail(app.email, `Tomorrow: Your Free Clarity Call, ${app.first_name}`, html);
          if (ok) {
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
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.booked&call_date=gte.${oneHour.toISOString()}&call_date=lte.${oneHourPlus.toISOString()}&select=email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (reminder1hRes.ok) {
      const upcoming1h = await reminder1hRes.json();
      for (const app of upcoming1h) {
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        if (!sent.some(s => s.email_type === 'reminder_1h')) {
          const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min`;
          const html = getReminderHtml('reminder_1h', app.first_name, calendlyUrl, app.call_date);
          const ok = await sendEmail(app.email, `Starting in 1 hour: your Free Clarity Call`, html);
          if (ok) {
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
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.booked&call_date=gte.${oneDayAgo.toISOString()}&call_date=lte.${twoHoursAgo.toISOString()}&select=email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (noShowRes.ok) {
      const noShows = await noShowRes.json();
      for (const app of noShows) {
        const sent = await getAlreadySent(SUPABASE_URL, SUPABASE_KEY, app.email);
        if (!sent.some(s => s.email_type === 'no_show')) {
          const calendlyUrl = `https://calendly.com/robinekren/free-clarity-call-30-min?name=${encodeURIComponent(app.first_name + ' ' + app.last_name)}&email=${encodeURIComponent(app.email)}`;
          const html = getReminderHtml('no_show', app.first_name, calendlyUrl, app.call_date);
          const ok = await sendEmail(app.email, `We missed you: let's rebook`, html);
          if (ok) {
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
      `${SUPABASE_URL}/rest/v1/applications?call_status=eq.no_show&select=email,first_name,last_name,call_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (noShowRebookRes.ok) {
      const noShowPeople = await noShowRebookRes.json();
      const rebookSchedule = [
        { day: 2, index: 1, subject: "Still want that roadmap, {name}?" },
        { day: 5, index: 2, subject: "Last chance to rebook: then I'm closing your file" },
      ];

      const rebookTemplates = {
        1: (fn, url) => `<p>Hey ${fn},</p>
<p>Things come up, I get it. But your custom roadmap is still waiting.</p>
<p>I kept a spot open for you. Same deal: 30 minutes, we audit your setup, give you the plan, you decide what to do with it.</p>
<p style="text-align:center;margin:30px 0;"><a href="${url}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Rebook Your Free Clarity Call</a></p>
<p>Robin & The EKO Growth Team</p>`,

        2: (fn, url) => `<p>Hey ${fn},</p>
<p>This is my last message about rebooking.</p>
<p>I'll be closing your application file after this. If you still want the Free Clarity Call and the custom roadmap, book now:</p>
<p style="text-align:center;margin:30px 0;"><a href="${url}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#DDBB6C,#C99B43);color:#11160f;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">Final Rebook: Last Spot</a></p>
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
              const ok = await sendEmail(app.email, subject, wrapEmail(html));
              if (ok) {
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

// ═══════════════════════════════════════════
// NORA AUTO-REPLY — Merged from nora-reply.js
// Checks unread customer messages, generates AI reply in Robin's voice
// ═══════════════════════════════════════════
async function handleNoraReply(req, res, SUPABASE_URL, SUPABASE_KEY) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Missing env vars for Nora' });
  }
  try {
    const msgsRes = await fetch(`${SUPABASE_URL}/rest/v1/messages?sender_type=eq.customer&read_at=is.null&order=created_at.asc&limit=20`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const unreadMessages = await msgsRes.json();
    if (!unreadMessages.length) return res.status(200).json({ message: 'No unread messages', replied: 0 });

    const grouped = {};
    for (const msg of unreadMessages) { if (!grouped[msg.application_id]) grouped[msg.application_id] = []; grouped[msg.application_id].push(msg); }

    let repliedCount = 0;
    for (const [appId, messages] of Object.entries(grouped)) {
      const appRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${appId}&select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
      const [app] = await appRes.json();
      if (!app) continue;

      const recentTeamRes = await fetch(`${SUPABASE_URL}/rest/v1/messages?application_id=eq.${appId}&sender_type=eq.team&order=created_at.desc&limit=1`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
      const [lastTeamMsg] = await recentTeamRes.json();
      if (lastTeamMsg) {
        if (new Date(lastTeamMsg.created_at).getTime() > new Date(messages[0].created_at).getTime()) {
          for (const msg of messages) await noraMarkRead(SUPABASE_URL, SUPABASE_KEY, msg.id);
          continue;
        }
      }

      const histRes = await fetch(`${SUPABASE_URL}/rest/v1/messages?application_id=eq.${appId}&order=created_at.asc&limit=30`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
      const history = await histRes.json();
      const stage = app.stage || 'applied';
      const tier = app.selected_tier;
      const name = app.name || 'there';
      const firstName = name.split(' ')[0];

      const systemPrompt = `You are Nora, ghostwriting as Robin Ekren — CEO of GrowthEko. VOICE: Casual, direct, confident. Short sentences. Use "bro","dude","let's go" naturally. No corporate fluff. No emojis overload. Under 50 words. CUSTOMER: ${firstName}, Stage: ${stage}, Tier: ${tier||'none'}, Business: ${app.product_type||'unknown'}, Revenue: ${app.current_revenue||'unknown'}, Challenge: ${app.biggest_challenge||'unknown'}. STRATEGY: applied=build trust, booked=confirm excitement, sold=welcome+next step, active=check in, upsell_ready=reference results. ONE message. End with clarity.`;

      const chatMessages = history.map(m => ({ role: m.sender_type === 'customer' ? 'user' : 'assistant', content: m.content }));
      const latestCustomerMsg = messages[messages.length - 1].content;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, system: systemPrompt, messages: [...chatMessages.slice(-15), { role: 'user', content: latestCustomerMsg }] })
      });
      if (!aiRes.ok) { console.error('Claude API error:', await aiRes.text()); continue; }
      const aiData = await aiRes.json();
      const reply = aiData.content[0]?.text;
      if (!reply) continue;

      await fetch(`${SUPABASE_URL}/rest/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ application_id: appId, sender_type: 'team', sender_name: 'Nora', content: reply, message_type: 'text', metadata: { auto_generated: true } }) });
      await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${appId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ last_message_at: new Date().toISOString() }) });

      if (RESEND_KEY && app.email) {
        await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` }, body: JSON.stringify({ from: GROWTHEKO_RESEND_FROM, to: [app.email], subject: `Hey ${firstName}: quick reply`, html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;"><div style="font-family:'Times New Roman',serif;font-size:18px;font-weight:700;letter-spacing:4px;text-transform:uppercase;margin-bottom:30px;color:#111;">GROWTHEKO</div><div style="font-size:15px;line-height:1.7;color:#333;margin-bottom:30px;">${reply.replace(/\n/g,'<br>')}</div><a href="https://www.growtheko.com/chat" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#0066FF,#0052CC);color:white;text-decoration:none;border-radius:10px;font-size:13px;font-weight:600;">Reply in Your Portal →</a></div>` }) });
      }

      for (const msg of messages) await noraMarkRead(SUPABASE_URL, SUPABASE_KEY, msg.id);
      repliedCount++;
    }
    return res.status(200).json({ success: true, replied: repliedCount, checked: Object.keys(grouped).length, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Nora reply error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function noraMarkRead(supabaseUrl, supabaseKey, messageId) {
  await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
}
