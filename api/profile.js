import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Check cache first
  const cached = await getCache('profile', symbol);
  if (cached) {
    return res.status(200).json({ ...cached, _cached: true });
  }

  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile,price`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const profile = d?.quoteSummary?.result?.[0];
    const asset   = profile?.assetProfile || {};
    const price   = profile?.price || {};

    const result = {
      name:            price.longName || price.shortName || symbol,
      ticker:          symbol,
      exchange:        price.exchangeName || '',
      finnhubIndustry: asset.industry || asset.sector || '',
      weburl:          asset.website || '',
      country:         asset.country || '',
    };

    await setCache('profile', symbol, result, TTL.PROFILE);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
