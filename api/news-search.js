import { getCache, setCache, TTL } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const sym = symbol.toUpperCase().trim();

  // Cache news for 30 minutes — no need to re-fetch on every options modal open
  const cached = await getCache('news', sym);
  if (cached) return res.status(200).json({ headlines: cached, _cached: true });

  try {
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const r = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`
    );

    if (!r.ok) return res.status(200).json({ headlines: [] });

    const articles = await r.json();
    if (!Array.isArray(articles)) return res.status(200).json({ headlines: [] });

    const headlines = articles.slice(0, 5).map(a => ({
      headline: a.headline || '',
      summary:  (a.summary || '').slice(0, 200),
      source:   a.source   || '',
      time:     new Date((a.datetime || 0) * 1000)
                  .toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    })).filter(h => h.headline); // drop articles with empty headlines

    await setCache('news', sym, headlines, TTL.NEWS);
    res.status(200).json({ headlines });
  } catch(e) {
    // Non-fatal — return empty array so AI still runs without news
    res.status(200).json({ headlines: [], error: e.message });
  }
}
