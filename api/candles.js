export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, tf } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const outputsize = tf === 'full' ? 'full' : 'compact';

  try {
    const r = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=${outputsize}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
    );
    const data = await r.json();

    if (data['Error Message']) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
    if (data['Note'])        return res.status(429).json({ error: 'Alpha Vantage rate limit reached. Wait 1 minute.' });
    if (data['Information']) return res.status(429).json({ error: 'Alpha Vantage daily call limit reached (25/day on free tier).' });

    const series = data['Time Series (Daily)'];
    if (!series) return res.status(404).json({ error: 'No candle data returned.' });

    const candles = Object.entries(series)
      .map(([date, v]) => ({
        date,
        open:   parseFloat(v['1. open']),
        high:   parseFloat(v['2. high']),
        low:    parseFloat(v['3. low']),
        close:  parseFloat(v['4. close']),
        volume: parseInt(v['5. volume']),
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({ candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
