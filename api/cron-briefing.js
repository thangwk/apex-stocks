// Daily cron job — runs at 8AM UTC every day
// Reads WATCHLIST_TICKERS env var (comma-separated, e.g. "AAPL,TSLA,MSFT")
// Calls the watchlist-analyze handler and sends Telegram briefing

import handler from './watchlist-analyze.js';

export default async function cronHandler(req, res) {
  // Vercel cron jobs send a GET request
  const tickers = (process.env.WATCHLIST_TICKERS || '')
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return res.status(200).json({ message: 'No tickers configured. Add WATCHLIST_TICKERS to env vars.' });
  }

  // Reuse the watchlist-analyze handler with a POST-like body
  req.method = 'POST';
  req.body   = { tickers };

  return handler(req, res);
}
