// netlify/edge-functions/habits-config.js
import { getSupabase, getUser, json, cors, supabaseQuery } from './_shared.js';

export default async (request) => {
  if (request.method === 'OPTIONS') return cors();

  const { url, key } = getSupabase();
  const user = await getUser(request, url, key);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // GET — fetch habit list
  if (request.method === 'GET') {
    const { data } = await supabaseQuery(url, key,
      `habits_config?user_id=eq.${user.id}&order=sort_order.asc`
    );
    return json({ habits: Array.isArray(data) ? data : [] });
  }

  // POST — save full habit list (upsert all)
  if (request.method === 'POST') {
    const body = await request.json();
    const habits = (body.habits || []).map((h, i) => ({
      user_id: user.id,
      habit_id: h.id,
      name: h.name,
      emoji: h.emoji || '🎯',
      start_time: h.start || null,
      end_time: h.end || null,
      sort_order: i,
    }));

    // Delete existing then insert fresh (simplest approach)
    await supabaseQuery(url, key,
      `habits_config?user_id=eq.${user.id}`,
      { method: 'DELETE', prefer: 'return=minimal' }
    );

    if (habits.length > 0) {
      await supabaseQuery(url, key, 'habits_config', {
        method: 'POST',
        body: JSON.stringify(habits),
        prefer: 'return=minimal',
      });
    }

    return json({ success: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
