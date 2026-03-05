import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Check cache first
  const cached = await getCache('metrics', symbol);
  if (cached) {
    return res.status(200).json({ metric: cached, _cached: true });
  }

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${process.env.FINNHUB_API_KEY}`
    );
    const data = await r.json();
    // Cache the metric object
    if (data.metric) await setCache('metrics', symbol, data.metric, TTL.METRICS);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
