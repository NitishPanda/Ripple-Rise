// netlify/edge-functions/daily-tasks.js

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
  status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
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

  const reqUrl = new URL(request.url);

  if (request.method === 'GET') {
    const from = reqUrl.searchParams.get('from');
    const to = reqUrl.searchParams.get('to');
    if (!from || !to) return json({ error: 'from and to required' }, 400);
    const { data } = await supa(url, key, `daily_tasks?user_id=eq.${user.id}&date=gte.${from}&date=lte.${to}&order=date.asc,created_at.asc`);
    return json({ tasks: Array.isArray(data) ? data : [] });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const { date, name, duration, category } = body;
    if (!date || !name || !duration || !category) return json({ error: 'date, name, duration, category required' }, 400);
    const row = { user_id: user.id, date, name, duration: parseInt(duration), category };
    const { data, status } = await supa(url, key, 'daily_tasks', { method: 'POST', body: JSON.stringify(row), prefer: 'return=representation' });
    if (status >= 400) return json({ error: data }, status);
    return json({ task: Array.isArray(data) ? data[0] : data });
  }

  if (request.method === 'DELETE') {
    const id = reqUrl.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);
    const { status } = await supa(url, key, `daily_tasks?id=eq.${id}&user_id=eq.${user.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (status >= 400) return json({ error: 'Delete failed' }, status);
    return json({ success: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
