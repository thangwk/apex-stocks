import { getCache, setCache, TTL } from './_redis.js';

// GET /api/metrics?symbol=AAPL          → Finnhub fundamentals
// GET /api/metrics?symbol=AAPL&type=targets → Finnhub analyst price targets + recommendation

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const { symbol, type } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const sym    = symbol.toUpperCase();
  const token  = process.env.FINNHUB_API_KEY;

  // ── Analyst targets ─────────────────────────────────────────────
  if (type === 'targets') {
    const cacheKey = 'targets';
    const cached = await getCache(cacheKey, sym);
    if (cached && cached.targetMean) return res.status(200).json({ ...cached, _cached: true });

    try {
      // Only fetch price-target + recommendation — quote is already cached by quote.js
      // Removing the redundant Finnhub /quote call saves 1 API call per targets request
      const [targetRes, recRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${sym}&token=${token}`),
        fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${token}`),
      ]);
      const targetData = await targetRes.json();
      const recData    = await recRes.json();

      const rec = Array.isArray(recData) ? recData[0] : null;
      // Use cached quote price if available, else derive upside % without an absolute price
      const { getCache: getCacheQ } = await import('./_redis.js');
      const cachedQuote = await getCacheQ('quote', sym);
      const price = cachedQuote?.c || 0;

      // Finnhub price-target (premium) — may be empty on free tier
      let targetMean   = targetData.targetMean   || null;
      let targetHigh   = targetData.targetHigh   || null;
      let targetLow    = targetData.targetLow    || null;
      let analysts     = targetData.numberOfAnalysts || null;

      // If price targets unavailable, derive from consensus sentiment + current price
      if (!targetMean && price > 0 && rec) {
        const total    = (rec.strongBuy||0)+(rec.buy||0)+(rec.hold||0)+(rec.sell||0)+(rec.strongSell||0);
        const bullish  = (rec.strongBuy||0)+(rec.buy||0);
        const bearish  = (rec.sell||0)+(rec.strongSell||0);
        const score    = total > 0 ? (rec.strongBuy*2 + rec.buy - rec.sell - rec.strongSell*2) / total : 0;
        // Map score to expected upside: strong buy ~+15%, buy ~+10%, hold ~+3%, sell ~-5%
        const upside   = score >= 1 ? 0.15 : score >= 0.3 ? 0.10 : score >= -0.3 ? 0.03 : -0.05;
        targetMean     = parseFloat((price * (1 + upside)).toFixed(2));
        targetHigh     = parseFloat((price * (1 + upside + 0.08)).toFixed(2));
        targetLow      = parseFloat((price * (1 + upside - 0.08)).toFixed(2));
        analysts       = total || null;
      }

      const result = {
        targetHigh,
        targetLow,
        targetMean,
        targetMedian: targetData.targetMedian || targetMean,
        analysts,
        derived: !targetData.targetMean, // flag so UI can show disclaimer
        strongBuy:  rec?.strongBuy  || 0,
        buy:        rec?.buy        || 0,
        hold:       rec?.hold       || 0,
        sell:       rec?.sell       || 0,
        strongSell: rec?.strongSell || 0,
      };

      if (result.targetMean) await setCache(cacheKey, sym, result, TTL.METRICS);
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
