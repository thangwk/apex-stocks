// Admin endpoint to clear cached data for a symbol
// Usage: /api/cache-clear?symbol=MSFT&type=profile  (or type=all)
import { getClient } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, type = 'all' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const redis = await getClient();
    const types = type === 'all' ? ['profile', 'metrics', 'quote'] : [type];
    const deleted = [];

    for (const t of types) {
      const key = `apex:cache:${t}:${symbol.toUpperCase()}`;
      const result = await redis.del(key);
      if (result > 0) deleted.push(t);
    }

    res.status(200).json({ ok: true, symbol, cleared: deleted });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
