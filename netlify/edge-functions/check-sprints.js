// netlify/edge-functions/check-sprints.js
// Called by Supabase pg_cron every minute
// Sends Web Push notifications for completed sprints using VAPID

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function sendWebPush(subscription, payload, vapidPublicKey, vapidPrivateKey) {
  const endpoint = subscription.endpoint;
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);

  // Build JWT header + payload
  const header = { typ: 'JWT', alg: 'ES256' };
  const jwtPayload = { aud: origin, exp: now + 43200, sub: 'mailto:admin@vyoraa.app' };
  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsignedToken = `${encode(header)}.${encode(jwtPayload)}`;

  // Import EC private key
  const pemKey = vapidPrivateKey.replace(/\\n/g, '\n');
  const keyData = pemKey.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey.buffer, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, cryptoKey, new TextEncoder().encode(unsignedToken));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${unsignedToken}.${sig}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: JSON.stringify(payload),
  });

  return { ok: res.ok, status: res.status };
}

export default async (req, context) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_KEY'));
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

    // Find unfired sprints that have ended
    const { data: sprints, error } = await supabase
      .from('sprint_timers')
      .select('*')
      .eq('fired', false)
      .lte('end_time', new Date().toISOString());

    if (error) throw error;
    if (!sprints?.length) return new Response(JSON.stringify({ ok: true, fired: 0 }), { headers });

    let fired = 0;
    for (const sprint of sprints) {
      const sub = sprint.push_subscription;
      if (!sub?.endpoint) continue;

      try {
        const result = await sendWebPush(
          sub,
          {
            title: '⚡ Sprint Complete!',
            body: `${sprint.task_name} — ${sprint.duration_mins} min done. How did it go?`,
            tag: 'sprint-done',
          },
          vapidPublicKey,
          vapidPrivateKey
        );

        if (result.ok || result.status === 201) {
          await supabase.from('sprint_timers').update({ fired: true }).eq('id', sprint.id);
          fired++;
        } else if (result.status === 410) {
          // Subscription expired — clean up
          await supabase.from('sprint_timers').update({ fired: true }).eq('id', sprint.id);
        }
      } catch(e) { console.warn('Push error:', e.message); }
    }

    return new Response(JSON.stringify({ ok: true, fired }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
