export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, tf } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Map timeframe to outputsize (number of data points)
  const outputMap = { compact: 30, full: 365 };
  const outputsize = outputMap[tf] || 30;

  try {
    const r = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const data = await r.json();

    if (data.status === 'error') return res.status(400).json({ error: data.message || 'Twelve Data error' });
    if (!data.values || data.values.length === 0) return res.status(404).json({ error: 'No candle data found for this symbol.' });

    // Twelve Data returns newest first — reverse to oldest first
    const candles = data.values.reverse().map(v => ({
      date:   v.datetime,
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
    }));

    res.status(200).json({ candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
