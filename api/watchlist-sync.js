import { saveWatchlist } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { tickers } = req.body || {};
  if (!Array.isArray(tickers)) return res.status(400).json({ error: 'tickers array required' });

  await saveWatchlist(tickers);
  res.status(200).json({ ok: true, count: tickers.length });
}
