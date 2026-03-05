import { getWatchlist } from './_redis.js';
import analyzeHandler from './watchlist-analyze.js';

export default async function handler(req, res) {
  const tickers = await getWatchlist();

  if (tickers.length === 0) {
    console.log('Cron: watchlist is empty, skipping.');
    return res.status(200).json({ message: 'Watchlist empty — nothing to analyse.' });
  }

  console.log(`Cron: analysing ${tickers.length} tickers:`, tickers);

  req.method = 'POST';
  req.body   = { tickers };

  return analyzeHandler(req, res);
}
