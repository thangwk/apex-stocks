export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, resolution, from, to } = req.query;
  if (!symbol || !resolution || !from || !to)
    return res.status(400).json({ error: 'symbol, resolution, from, to required' });
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`
    );
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
