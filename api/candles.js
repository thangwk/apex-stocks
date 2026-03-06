import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Prevent browser/CDN from caching — we handle caching via Redis ourselves
  res.setHeader('Cache-Control', 'no-store');
  const { symbol, tf } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const outputsize = tf === 'full' ? 365 : 60;

  try {
    // Use same cache key as _analysis.js fetchCandles — shared cache
    const cached = await getCache('candles', symbol);
    if (cached) return res.status(200).json({ candles: cached, _cached: true });

    const r = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const data = await r.json();

    if (data.status === 'error') return res.status(400).json({ error: data.message || 'Twelve Data error' });
    if (!data.values?.length)    return res.status(404).json({ error: 'No candle data found.' });

    const candles = data.values.reverse().map(v => {
      const o = parseFloat(v.open);
      const h = parseFloat(v.high);
      const l = parseFloat(v.low);
      const c = parseFloat(v.close);
      return {
        date:   v.datetime,
        open:   isFinite(o) ? o : c,
        high:   isFinite(h) ? h : c,
        low:    isFinite(l) ? l : c,
        close:  isFinite(c) ? c : 0,
        volume: parseInt(v.volume) || 0,
      };
    }).filter(c => c.close > 0); // drop any zero-price candles

    await setCache('candles', symbol, candles, TTL.CANDLES);
    res.status(200).json({ candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
