import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Check cache — but skip if cached result has empty finnhubIndustry
  const cached = await getCache('profile', symbol);
  if (cached && cached.finnhubIndustry) {
    return res.status(200).json({ ...cached, _cached: true });
  }

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`
    );
    const d = await r.json();

    if (!d || !d.name) return res.status(404).json({ error: 'Profile not found' });

    const result = {
      name:            d.name || symbol,
      ticker:          symbol,
      exchange:        d.exchange || '',
      finnhubIndustry: d.finnhubIndustry || '',
      weburl:          d.weburl || '',
      country:         d.country || '',
      logo:            d.logo || '',
    };

    // Only cache if we got valid industry data
    if (result.finnhubIndustry) {
      await setCache('profile', symbol, result, TTL.PROFILE);
    }

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
