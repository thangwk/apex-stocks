import { getCache, setCache, TTL } from './_redis.js';

// FMP stable endpoint: ratings-snapshot
// Returns: symbol, rating, overallScore, discountedCashFlowScore,
//          returnOnEquityScore, returnOnAssetsScore, debtToEquityScore,
//          priceToEarningsScore, priceToBookScore

function scoreToRecommendation(score) {
  if (score >= 5) return 'Strong Buy';
  if (score >= 4) return 'Buy';
  if (score >= 3) return 'Neutral';
  if (score >= 2) return 'Underperform';
  return 'Sell';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const sym = symbol.toUpperCase();

  // Check cache first (24 hours) — skip if cached result is empty
  const cached = await getCache('fmp', sym);
  if (cached && cached.rating) return res.status(200).json({ ...cached, _cached: true });

  try {
    const apiKey = process.env.FMP_API_KEY;
    const url = `https://financialmodelingprep.com/stable/ratings-snapshot?symbol=${sym}&apikey=${apiKey}`;
    const r = await fetch(url);
    const raw = await r.text();

    let data;
    try { data = JSON.parse(raw); } catch(e) { return res.status(200).json({ rating: null, raw, parseError: e.message }); }
    const d = Array.isArray(data) ? data[0] : (data?.data?.[0] || null);

    if (!d) return res.status(200).json({ rating: null, recommendation: null });

    const result = {
      rating:           d.rating         || null,  // A, B, C, D, S
      overallScore:     d.overallScore    || null,  // 1-5
      dcfScore:         d.discountedCashFlowScore || null,
      roeScore:         d.returnOnEquityScore     || null,
      roaScore:         d.returnOnAssetsScore     || null,
      debtScore:        d.debtToEquityScore       || null,
      peScore:          d.priceToEarningsScore    || null,
      pbScore:          d.priceToBookScore        || null,
      recommendation:   scoreToRecommendation(d.overallScore || 0),
    };

    await setCache('fmp', sym, result, TTL.METRICS); // 24h
    res.status(200).json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
