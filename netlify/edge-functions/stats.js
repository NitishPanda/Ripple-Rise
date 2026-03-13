// netlify/edge-functions/stats.js

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

const NEG_CATS = ['timepass', 'waste', 'procrastinating'];

export default async (request) => {
  if (request.method === 'OPTIONS') return cors();
  const { url, key } = getSupabase();
  const user = await getUser(request, url, key);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { from, to } = await request.json();
  if (!from || !to) return json({ error: 'from and to required' }, 400);

  const { data: habitsRaw } = await supa(url, key, `habits_config?user_id=eq.${user.id}&order=sort_order.asc`);
  const habits = Array.isArray(habitsRaw) ? habitsRaw : [];

  const { data: habitsData } = await supa(url, key, `daily_habits?user_id=eq.${user.id}&date=gte.${from}&date=lte.${to}`);
  const habitRows = Array.isArray(habitsData) ? habitsData : [];

  const { data: tasksData } = await supa(url, key, `daily_tasks?user_id=eq.${user.id}&date=gte.${from}&date=lte.${to}`);
  const taskRows = Array.isArray(tasksData) ? tasksData : [];

  const habitStats = {};
  habits.forEach(h => { habitStats[h.habit_id] = { name: h.name, emoji: h.emoji, done: 0, total: 0 }; });

  const allDates = new Set(habitRows.map(r => r.date));
  allDates.forEach(date => {
    habits.forEach(h => {
      if (!habitStats[h.habit_id]) return;
      habitStats[h.habit_id].total++;
      const row = habitRows.find(r => r.date === date && r.habit_id === h.habit_id);
      if (row?.completed) habitStats[h.habit_id].done++;
    });
  });

  const daysTracked = allDates.size;
  let posMins = 0, negMins = 0, neuMins = 0;
  const catBreakdown = {};

  taskRows.forEach(t => {
    const dur = t.duration || 0;
    if (NEG_CATS.includes(t.category)) negMins += dur;
    else if (t.category === 'necessity' || t.category === 'emergency') neuMins += dur;
    else posMins += dur;
    catBreakdown[t.category] = (catBreakdown[t.category] || 0) + dur;
  });

  habitRows.forEach(r => {
    if (!r.completed) return;
    const habit = habits.find(h => h.habit_id === r.habit_id);
    if (habit?.start_time && habit?.end_time) {
      const [sh, sm] = habit.start_time.split(':').map(Number);
      const [eh, em] = habit.end_time.split(':').map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins > 0) posMins += mins;
    }
  });

  const dayVerdicts = { productive: 0, mostly: 0, unproductive: 0, critical: 0, wasted: 0, nodata: 0 };
  const tasksByDate = {};
  taskRows.forEach(t => { if (!tasksByDate[t.date]) tasksByDate[t.date] = []; tasksByDate[t.date].push(t); });

  const fromDate = new Date(from), toDate = new Date(to);
  const dateRange = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    dateRange.push(d.toISOString().split('T')[0]);
  }

  dateRange.forEach(date => {
    const tasks = tasksByDate[date] || [];
    const dayHabitRows = habitRows.filter(r => r.date === date);
    let dayPos = 0, dayNeg = 0, dayNeu = 0;
    dayHabitRows.forEach(r => {
      if (!r.completed) return;
      const habit = habits.find(h => h.habit_id === r.habit_id);
      if (habit?.start_time && habit?.end_time) {
        const [sh, sm] = habit.start_time.split(':').map(Number);
        const [eh, em] = habit.end_time.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) dayPos += mins;
      }
    });
    tasks.forEach(t => {
      if (NEG_CATS.includes(t.category)) dayNeg += t.duration;
      else if (t.category === 'necessity' || t.category === 'emergency') dayNeu += t.duration;
      else dayPos += t.duration;
    });
    const total = dayPos + dayNeg + dayNeu;
    if (total === 0 && dayHabitRows.length === 0) { dayVerdicts.nodata++; return; }
    const negPct = total > 0 ? (dayNeg / total) * 100 : 0;
    if (negPct >= 60) dayVerdicts.wasted++;
    else if (negPct >= 40) dayVerdicts.critical++;
    else if (negPct >= 25) dayVerdicts.unproductive++;
    else if (negPct > 0) dayVerdicts.mostly++;
    else dayVerdicts.productive++;
  });

  let bestStreak = 0, currentStreak = 0, worstGap = 0, currentGap = 0;
  dateRange.forEach(date => {
    const completedCount = habitRows.filter(r => r.date === date && r.completed).length;
    const pct = habits.length > 0 ? (completedCount / habits.length) * 100 : 0;
    if (pct >= 80) { currentStreak++; currentGap = 0; if (currentStreak > bestStreak) bestStreak = currentStreak; }
    else { currentGap++; currentStreak = 0; if (currentGap > worstGap) worstGap = currentGap; }
  });

  const weeklyTrend = [];
  for (let i = 0; i < dateRange.length; i += 7) {
    const weekDates = dateRange.slice(i, i + 7);
    let weekPos = 0, weekNeg = 0, weekNeu = 0;
    weekDates.forEach(date => {
      (tasksByDate[date] || []).forEach(t => {
        if (NEG_CATS.includes(t.category)) weekNeg += t.duration;
        else if (t.category === 'necessity' || t.category === 'emergency') weekNeu += t.duration;
        else weekPos += t.duration;
      });
      habitRows.filter(r => r.date === date && r.completed).forEach(r => {
        const habit = habits.find(h => h.habit_id === r.habit_id);
        if (habit?.start_time && habit?.end_time) {
          const [sh, sm] = habit.start_time.split(':').map(Number);
          const [eh, em] = habit.end_time.split(':').map(Number);
          const mins = (eh * 60 + em) - (sh * 60 + sm);
          if (mins > 0) weekPos += mins;
        }
      });
    });
    const habitCompletions = weekDates.reduce((acc, date) => acc + habitRows.filter(r => r.date === date && r.completed).length, 0);
    const habitTotal = weekDates.length * habits.length;
    weeklyTrend.push({
      label: weekDates[0].slice(5),
      habitPct: habitTotal > 0 ? Math.round(habitCompletions / habitTotal * 100) : 0,
      negPct: (weekPos+weekNeg+weekNeu) > 0 ? Math.round(weekNeg / (weekPos+weekNeg+weekNeu) * 100) : 0,
      totalMins: weekPos + weekNeg + weekNeu,
    });
  }

  return json({
    period: { from, to, daysTracked },
    habits: Object.entries(habitStats).map(([id, s]) => ({
      id, name: s.name, emoji: s.emoji,
      pct: s.total > 0 ? Math.round(s.done / s.total * 100) : 0,
      done: s.done, total: s.total,
    })),
    time: {
      productive: posMins, negative: negMins, neutral: neuMins,
      total: posMins + negMins + neuMins,
      negPct: (posMins+negMins+neuMins) > 0 ? Math.round(negMins/(posMins+negMins+neuMins)*100) : 0,
    },
    categories: catBreakdown,
    verdicts: dayVerdicts,
    streaks: { best: bestStreak, worstGap, current: currentStreak },
    weeklyTrend,
  });
};
