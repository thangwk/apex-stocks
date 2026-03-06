import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
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

    const c  = parseFloat(d.close);
    const pc = parseFloat(d.previous_close);
    // Guard: reject response if price is missing or non-numeric
    if (!isFinite(c) || c <= 0) {
      return res.status(404).json({ error: `No valid price data for ${symbol}` });
    }
    const result = {
      c,
      o:  parseFloat(d.open)  || c,
      h:  parseFloat(d.high)  || c,
      l:  parseFloat(d.low)   || c,
      pc: isFinite(pc) && pc > 0 ? pc : c,
    };

    await setCache('quote', symbol, result, TTL.QUOTE);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
