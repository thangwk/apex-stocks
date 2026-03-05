import { getWatchlist } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ownerChatId = process.env.TELEGRAM_CHAT_ID;
  const tickers = await getWatchlist(ownerChatId);
  res.status(200).json({ tickers });
}
