// Unified watchlist endpoint
// GET  /api/watchlist        → load tickers from Redis (owner)
// POST /api/watchlist        → sync tickers to Redis (owner)
// PUT  /api/watchlist        → run analysis and send Telegram briefing

import { getWatchlist, saveWatchlist } from './_redis.js';
import { runAnalysis, sendTelegram }   from './_analysis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ownerChatId = process.env.TELEGRAM_CHAT_ID;

  // GET — load
  if (req.method === 'GET') {
    const tickers = await getWatchlist(ownerChatId);
    return res.status(200).json({ tickers });
  }

  // POST — sync
  if (req.method === 'POST') {
    const { tickers } = req.body || {};
    if (!Array.isArray(tickers)) return res.status(400).json({ error: 'tickers array required' });
    await saveWatchlist(ownerChatId, tickers);
    return res.status(200).json({ ok: true, count: tickers.length });
  }

  // PUT — analyze and send briefing
  if (req.method === 'PUT') {
    const { tickers } = req.body || {};
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0)
      return res.status(400).json({ error: 'tickers array required' });

    const { results, message } = await runAnalysis(tickers);
    try {
      await sendTelegram(ownerChatId, message);
    } catch(e) {
      console.error('Telegram send failed:', e.message);
    }
    return res.status(200).json({ results });
  }

  res.status(405).end();
}
