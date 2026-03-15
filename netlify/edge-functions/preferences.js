// netlify/edge-functions/preferences.js

const getSupabase = () => ({ url: Deno.env.get('SUPABASE_URL'), key: Deno.env.get('SUPABASE_KEY') });

const getUser = async (request, url, key) => {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { 'Authorization': auth, 'apikey': key } });
  return res.ok ? res.json() : null;
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
});

const cors = () => new Response(null, {
  status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
});

const supa = async (url, key, path, options = {}) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': options.prefer || 'return=representation', ...(options.headers || {}) }
  });
  const text = await res.text();
  try { return { data: JSON.parse(text), status: res.status }; } catch { return { data: text, status: res.status }; }
};

export default async (request) => {
  if (request.method === 'OPTIONS') return cors();
  const { url, key } = getSupabase();
  const user = await getUser(request, url, key);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // GET — fetch preferences
  if (request.method === 'GET') {
    const { data } = await supa(url, key, `user_preferences?user_id=eq.${user.id}`);
    const prefs = Array.isArray(data) && data.length ? data[0] : { theme: 'dark' };
    return json({ theme: prefs.theme, vapid_key: Deno.env.get('VAPID_PUBLIC_KEY') || '' });
  }

  // POST — save preferences
  if (request.method === 'POST') {
    const body = await request.json();
    const theme = body.theme === 'light' ? 'light' : 'dark';
    const row = { user_id: user.id, theme, updated_at: new Date().toISOString() };
    const { data, status } = await supa(url, key, 'user_preferences', {
      method: 'POST',
      body: JSON.stringify(row),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    });
    if (status >= 400) return json({ error: data }, status);
    return json({ theme });
  }

  return json({ error: 'Method not allowed' }, 405);
};
