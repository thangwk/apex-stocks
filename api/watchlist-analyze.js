import { runAnalysis } from './_analysis.js';
import { sendTelegram } from './_analysis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { tickers } = req.body || {};
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0)
    return res.status(400).json({ error: 'tickers array required' });

  const { results, message } = await runAnalysis(tickers);

  try {
    await sendTelegram(process.env.TELEGRAM_CHAT_ID, message);
  } catch(e) {
    console.error('Telegram send failed:', e.message);
  }

  res.status(200).json({ results });
}
