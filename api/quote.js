import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Check cache (15 min) — skip cache if ?live=1
  if (!req.query.live) {
    const cached = await getCache('quote', symbol);
    if (cached) {
      return res.status(200).json({ ...cached, _cached: true });
    }
  }

  try {
    const r = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const d = await r.json();
    if (d.status === 'error') return res.status(404).json({ error: d.message });

    const result = {
      c:  parseFloat(d.close),
      o:  parseFloat(d.open),
      h:  parseFloat(d.high),
      l:  parseFloat(d.low),
      pc: parseFloat(d.previous_close),
    };

    await setCache('quote', symbol, result, TTL.QUOTE);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
