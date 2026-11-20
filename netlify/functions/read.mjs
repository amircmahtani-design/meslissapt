// Reads clients' WhatsApp-style messages and returns their availability as JSON.
// Runs through Netlify AI Gateway (no API key needed). Rate limited per visitor.

const pad = n => String(n).padStart(2, '0');
const clean = (s, n) => String(s == null ? '' : s).slice(0, n);

function buildPrompt({ text, clients, weekStart, weekEnd, start, end }) {
  const S = pad(start), E = pad(end);
  return 'You turn messages from personal training clients into weekly availability.\n' +
    'The week is Monday ' + weekStart + ' to Sunday ' + weekEnd + '.\n' +
    'Known clients: ' + (clients.length ? clients.join(', ') : 'none') + '. Use the known name when a message clearly refers to one of them (first names, nicknames, typos).\n' +
    'The trainer works ' + S + ':00 to ' + E + ':00. Interpret: early morning = ' + S + ':00-09:00, morning = ' + S + ':00-12:00, lunchtime = 12:00-14:00, afternoon = 12:00-17:00, evening = 17:00-' + E + ':00, "after X" = X until ' + E + ':00, "before X" = ' + S + ':00 until X, "any time"/"flexible" = ' + S + ':00-' + E + ':00, weekdays = mon-fri. ' +
    'A time like "8.30 to 9.30" or "8:30-9:30" is that exact window. A bare start time like "at 7" or "7am" means a one hour window starting then (assume am if before 11, otherwise pm, unless stated). ' +
    'If a message says "every day" or lists days, include each of those days. Days not mentioned are unavailable. Round to 30 minutes, 24 hour HH:MM.\n' +
    'If a client says how many sessions they want this week, give it as sessions, otherwise null.\n' +
    'Reply with JSON only, no prose, no code fences: {"people":[{"name":"Sara","sessions":3,"days":{"mon":[["06:00","08:00"]],"wed":[["06:00","08:00"]]}}]}\n\n' +
    'Messages:\n' + text;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_BASE_URL) {
    return Response.json({ error: 'ai_off' }, { status: 503 });
  }
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_json' }, { status: 400 }); }
  const text = clean(body.text, 8000).trim();
  if (!text) return Response.json({ error: 'empty' }, { status: 400 });
  const clients = (Array.isArray(body.clients) ? body.clients : []).slice(0, 60).map(n => clean(n, 40));
  const start = Math.min(23, Math.max(0, parseInt(body.start, 10) || 6));
  const end = Math.min(24, Math.max(start + 1, parseInt(body.end, 10) || 21));
  const prompt = buildPrompt({
    text, clients, start, end,
    weekStart: clean(body.weekStart, 12), weekEnd: clean(body.weekEnd, 12)
  });
  try {
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) return Response.json({ error: 'ai_failed', status: res.status }, { status: 502 });
    const msg = await res.json();
    const out = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = out.match(/\{[\s\S]*\}/);
    const data = m ? JSON.parse(m[0]) : { people: [] };
    return Response.json({ people: Array.isArray(data.people) ? data.people : [] });
  } catch (e) {
    return Response.json({ error: 'ai_failed' }, { status: 502 });
  }
};

export const config = {
  path: '/api/read',
  method: 'POST',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
