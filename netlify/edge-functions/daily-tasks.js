// netlify/edge-functions/daily-tasks.js
import { getSupabase, getUser, json, cors, supabaseQuery } from './utils.js';

export default async (request) => {
  if (request.method === 'OPTIONS') return cors();

  const { url, key } = getSupabase();
  const user = await getUser(request, url, key);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const reqUrl = new URL(request.url);

  // GET — fetch tasks for a date range
  if (request.method === 'GET') {
    const from = reqUrl.searchParams.get('from');
    const to   = reqUrl.searchParams.get('to');
    if (!from || !to) return json({ error: 'from and to required' }, 400);

    const { data } = await supabaseQuery(url, key,
      `daily_tasks?user_id=eq.${user.id}&date=gte.${from}&date=lte.${to}&order=date.asc,created_at.asc`
    );
    return json({ tasks: Array.isArray(data) ? data : [] });
  }

  // POST — add a task
  if (request.method === 'POST') {
    const body = await request.json();
    const { date, name, duration, category } = body;
    if (!date || !name || !duration || !category)
      return json({ error: 'date, name, duration, category required' }, 400);

    const row = { user_id: user.id, date, name, duration: parseInt(duration), category };
    const { data, status } = await supabaseQuery(url, key, 'daily_tasks', {
      method: 'POST',
      body: JSON.stringify(row),
      prefer: 'return=representation',
    });

    if (status >= 400) return json({ error: data }, status);
    return json({ task: Array.isArray(data) ? data[0] : data });
  }

  // DELETE — remove a task by id
  if (request.method === 'DELETE') {
    const id = reqUrl.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);

    const { status } = await supabaseQuery(url, key,
      `daily_tasks?id=eq.${id}&user_id=eq.${user.id}`,
      { method: 'DELETE', prefer: 'return=minimal' }
    );

    if (status >= 400) return json({ error: 'Delete failed' }, status);
    return json({ success: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
