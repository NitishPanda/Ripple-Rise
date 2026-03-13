// netlify/edge-functions/daily-habits.js
import { getSupabase, getUser, json, cors, supabaseQuery } from './utils.js';

export default async (request) => {
  if (request.method === 'OPTIONS') return cors();

  const { url, key } = getSupabase();
  const user = await getUser(request, url, key);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const reqUrl = new URL(request.url);

  // GET — fetch completions for a date range
  if (request.method === 'GET') {
    const from = reqUrl.searchParams.get('from');
    const to   = reqUrl.searchParams.get('to');
    if (!from || !to) return json({ error: 'from and to required' }, 400);

    const { data } = await supabaseQuery(url, key,
      `daily_habits?user_id=eq.${user.id}&date=gte.${from}&date=lte.${to}&order=date.asc`
    );
    return json({ rows: Array.isArray(data) ? data : [] });
  }

  // POST — toggle or update a habit completion
  if (request.method === 'POST') {
    const body = await request.json();
    const { date, habit_id, completed, miss_type, miss_reason } = body;
    if (!date || !habit_id) return json({ error: 'date and habit_id required' }, 400);

    const row = {
      user_id:     user.id,
      date,
      habit_id,
      completed:   !!completed,
      miss_type:   miss_type   || null,
      miss_reason: miss_reason || null,
    };

    const { data, status } = await supabaseQuery(url, key, 'daily_habits', {
      method:  'POST',
      body:    JSON.stringify(row),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
    });

    if (status >= 400) return json({ error: data }, status);
    return json({ row: Array.isArray(data) ? data[0] : data });
  }

  return json({ error: 'Method not allowed' }, 405);
};
