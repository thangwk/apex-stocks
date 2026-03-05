import { getWatchlist } from './_redis.js';
import { runAnalysis, sendTelegram } from './_analysis.js';

export default async function handler(req, res) {
  const tickers = await getWatchlist();

  if (tickers.length === 0) {
    return res.status(200).json({ message: 'Watchlist empty — nothing to analyse.' });
  }

  const { message, results } = await runAnalysis(tickers);
  await sendTelegram(process.env.TELEGRAM_CHAT_ID, message);

  res.status(200).json({ ok: true, count: results.length });
}
