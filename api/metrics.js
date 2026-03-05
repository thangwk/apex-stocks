import { getCache, setCache, TTL } from './_redis.js';

// GET /api/metrics?symbol=AAPL          → Finnhub fundamentals
// GET /api/metrics?symbol=AAPL&type=targets → Finnhub analyst price targets + recommendation

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const sym    = symbol.toUpperCase();
  const token  = process.env.FINNHUB_API_KEY;

  // ── Analyst targets ─────────────────────────────────────────────
  if (type === 'targets') {
    const cacheKey = 'targets';
    const cached = await getCache(cacheKey, sym);
    if (cached) return res.status(200).json({ ...cached, _cached: true });

    try {
      const [targetRes, recRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${sym}&token=${token}`),
        fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${token}`),
      ]);
      const targetData = await targetRes.json();
      const recData    = await recRes.json();

      // Latest recommendation period
      const rec = Array.isArray(recData) ? recData[0] : null;

      const result = {
        targetHigh:   targetData.targetHigh   || null,
        targetLow:    targetData.targetLow    || null,
        targetMean:   targetData.targetMean   || null,
        targetMedian: targetData.targetMedian || null,
        analysts:     targetData.numberOfAnalysts || null,
        // Analyst consensus: strongBuy, buy, hold, sell, strongSell counts
        strongBuy:    rec?.strongBuy  || 0,
        buy:          rec?.buy        || 0,
        hold:         rec?.hold       || 0,
        sell:         rec?.sell       || 0,
        strongSell:   rec?.strongSell || 0,
      };

      if (result.targetMean) await setCache(cacheKey, sym, result, TTL.METRICS); // 24h
      return res.status(200).json(result);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Standard fundamentals ────────────────────────────────────────
  const cached = await getCache('metrics', sym);
  if (cached) return res.status(200).json({ metric: cached, _cached: true });

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${token}`
    );
    const data = await r.json();
    if (data.metric) await setCache('metrics', sym, data.metric, TTL.METRICS);
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
