import { getCache, setCache, TTL } from './_redis.js';

// FMP endpoints we use:
// 1. DCF value:     /api/v3/discounted-cash-flow/AAPL
// 2. Company rating: /api/v3/rating/AAPL

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const sym = symbol.toUpperCase();

  // Check cache first (24 hours)
  const cached = await getCache('fmp', sym);
  if (cached) return res.status(200).json({ ...cached, _cached: true });

  try {
    const apiKey = process.env.FMP_API_KEY;
    const base   = 'https://financialmodelingprep.com/api/v3';

    const [dcfRes, ratingRes] = await Promise.all([
      fetch(`${base}/discounted-cash-flow/${sym}?apikey=${apiKey}`),
      fetch(`${base}/rating/${sym}?apikey=${apiKey}`),
    ]);

    const dcfData    = await dcfRes.json();
    const ratingData = await ratingRes.json();

    const dcf    = Array.isArray(dcfData)    ? dcfData[0]    : dcfData;
    const rating = Array.isArray(ratingData) ? ratingData[0] : ratingData;

    const result = {
      dcf:              dcf?.dcf          || null,   // FMP DCF intrinsic value
      stockPrice:       dcf?.['Stock Price'] || null,
      ratingScore:      rating?.ratingScore || null, // 1-5
      rating:           rating?.rating      || null, // S, A, B, C, D
      recommendation:   rating?.ratingRecommendation || null, // Strong Buy, Buy, etc.
      dcfScore:         rating?.ratingDetailsDCFScore || null,
      dcfRecommendation:rating?.ratingDetailsDCFRecommendation || null,
    };

    // Only cache if we got valid DCF data
    if (result.dcf) await setCache('fmp', sym, result, TTL.METRICS); // 24h

    res.status(200).json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
