// netlify/edge-functions/check-sprints.js
// Called by Supabase pg_cron every minute
// Finds sprints that have ended and sends FCM push notifications

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Generate FCM OAuth2 access token using service account
async function getFCMAccessToken(clientEmail, privateKey, projectId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Import private key
  const pemKey = privateKey.replace(/\\n/g, '\n');
  const keyData = pemKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Send FCM push to a Web Push subscription
async function sendFCMPush(subscription, title, body, accessToken, projectId) {
  const message = {
    message: {
      webpush: {
        notification: {
          title,
          body,
          icon: '/favicon-192-pwa.png',
          badge: '/favicon-192-pwa.png',
          requireInteraction: true,
          vibrate: [200, 100, 200, 100, 400],
        },
        fcm_options: { link: '/' }
      },
      token: subscription.fcm_token // FCM registration token
    }
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message)
    }
  );

  return res.ok;
}

export default async (req, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_KEY')
    );

    const projectId = Deno.env.get('FCM_PROJECT_ID');
    const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL');
    const privateKey = Deno.env.get('FCM_PRIVATE_KEY');

    // Get all unfired sprints that have ended
    const now = new Date().toISOString();
    const { data: sprints, error } = await supabase
      .from('sprint_timers')
      .select('*')
      .eq('fired', false)
      .lte('end_time', now);

    if (error) throw error;
    if (!sprints || sprints.length === 0) {
      return new Response(JSON.stringify({ ok: true, fired: 0 }), { headers: corsHeaders });
    }

    // Get FCM access token
    const accessToken = await getFCMAccessToken(clientEmail, privateKey, projectId);

    let fired = 0;
    for (const sprint of sprints) {
      const sub = sprint.push_subscription;
      if (!sub?.fcm_token) continue;

      const title = '⚡ Sprint Complete!';
      const body = `${sprint.task_name} — ${sprint.duration_mins} min done. How did it go?`;

      const ok = await sendFCMPush(sub, title, body, accessToken, projectId);

      if (ok) {
        // Mark as fired
        await supabase
          .from('sprint_timers')
          .update({ fired: true })
          .eq('id', sprint.id);
        fired++;
      }
    }

    return new Response(JSON.stringify({ ok: true, fired }), { headers: corsHeaders });

  } catch (err) {
    console.error('check-sprints error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders
    });
  }
};
