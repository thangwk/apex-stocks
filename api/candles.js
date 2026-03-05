import { getCache, setCache } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, tf } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const outputMap = { compact: 30, full: 365 };
  const outputsize = outputMap[tf] || 30;
  const cacheKey = `candles_${tf || 'compact'}`;
  const TTL_MS   = 6 * 60 * 60 * 1000; // 6 hours

  try {
    // Check cache first
    const cached = await getCache(cacheKey, symbol);
    if (cached) return res.status(200).json({ candles: cached, _cached: true });

    const r = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const data = await r.json();

    if (data.status === 'error') return res.status(400).json({ error: data.message || 'Twelve Data error' });
    if (!data.values || data.values.length === 0) return res.status(404).json({ error: 'No candle data found for this symbol.' });

    const candles = data.values.reverse().map(v => ({
      date:   v.datetime,
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
    }));

    await setCache(cacheKey, symbol, candles, TTL_MS);
    res.status(200).json({ candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
