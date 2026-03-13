// netlify/edge-functions/habits-config.js

const getSupabase = () => ({
  url: Deno.env.get('SUPABASE_URL'),
  key: Deno.env.get('SUPABASE_KEY'),
});

const getUser = async (request, url, key) => {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': key }
  });
  return res.ok ? res.json() : null;
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
});

const cors = () => new Response(null, {
  status: 204,
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
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

  if (request.method === 'GET') {
    const { data } = await supa(url, key, `habits_config?user_id=eq.${user.id}&order=sort_order.asc`);
    return json({ habits: Array.isArray(data) ? data : [] });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const habits = (body.habits || []).map((h, i) => ({
      user_id: user.id, habit_id: h.id, name: h.name, emoji: h.emoji || '🎯',
      start_time: h.start || null, end_time: h.end || null, sort_order: i,
    }));
    await supa(url, key, `habits_config?user_id=eq.${user.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (habits.length > 0) await supa(url, key, 'habits_config', { method: 'POST', body: JSON.stringify(habits), prefer: 'return=minimal' });
    return json({ success: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
