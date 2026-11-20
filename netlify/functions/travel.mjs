// Estimates typical driving times between places (off-peak and rush hour) for the trainer's day.
// Runs through Netlify AI Gateway (no API key needed). Rate limited per visitor.
const clean = (s, n) => String(s == null ? '' : s).slice(0, n);

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_BASE_URL) {
    return Response.json({ error: 'ai_off' }, { status: 503 });
  }
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_json' }, { status: 400 }); }
  const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, 80)
    .map(p => [clean(p && p[0], 80), clean(p && p[1], 80)]).filter(p => p[0] && p[1]);
  if (!pairs.length) return Response.json({ pairs: [] });
  const city = clean(body.city || 'Dubai, UAE', 60);
  const prompt =
    'You estimate typical driving times for a personal trainer who drives between clients.\n' +
    'Places are in or near ' + city + ' unless stated otherwise.\n' +
    'For each pair give typical door-to-door driving minutes off-peak (quiet roads, e.g. 10:00-16:00 or before 07:00) and in rush hour (weekday 07:00-10:00 and 16:00-20:00), including parking. Use realistic local traffic knowledge. Round to 5 minutes, minimum 5.\n' +
    'Reply with JSON only, no prose, no code fences: {"pairs":[{"a":"<exactly as given>","b":"<exactly as given>","off":15,"peak":25}]}\n\n' +
    'Pairs:\n' + pairs.map(p => '- ' + p[0] + ' <> ' + p[1]).join('\n');
  try {
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) return Response.json({ error: 'ai_failed', status: res.status }, { status: 502 });
    const msg = await res.json();
    const out = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = out.match(/\{[\s\S]*\}/);
    const data = m ? JSON.parse(m[0]) : { pairs: [] };
    const okN = v => Math.max(5, Math.min(240, Math.round((+v || 0) / 5) * 5));
    const list = (Array.isArray(data.pairs) ? data.pairs : [])
      .filter(p => p && p.a && p.b)
      .map(p => ({ a: clean(p.a, 80), b: clean(p.b, 80), off: okN(p.off), peak: okN(p.peak || p.off) }));
    return Response.json({ pairs: list });
  } catch (e) {
    return Response.json({ error: 'ai_failed' }, { status: 502 });
  }
};

export const config = {
  path: '/api/travel',
  method: 'POST',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
