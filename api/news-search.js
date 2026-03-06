// Fetches recent news headlines for a ticker using Finnhub news API
// Used to feed current world events into AI options analysis
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const { getCache, setCache } = await import('./_redis.js');
    const cacheKey = `news:${symbol.toUpperCase()}`;
    const cached = await getCache('news', symbol.toUpperCase());
    if (cached) return res.status(200).json({ headlines: cached });

    // Finnhub company news — last 7 days
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const r = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`
    );
    const articles = await r.json();
    if (!Array.isArray(articles)) return res.status(200).json({ headlines: [] });

    // Return top 5 most recent headlines + summaries
    const headlines = articles.slice(0, 5).map(a => ({
      headline: a.headline,
      summary: a.summary?.slice(0, 200) || '',
      source: a.source,
      time: new Date(a.datetime * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' }),
    }));

    // Cache 30 min
    await setCache('news', symbol.toUpperCase(), headlines, 30 * 60 * 1000);
    res.status(200).json({ headlines });
  } catch(e) {
    res.status(200).json({ headlines: [], error: e.message });
  }
}
