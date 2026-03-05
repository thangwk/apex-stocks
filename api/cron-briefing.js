import { getAllUsers, getWatchlist } from './_redis.js';
import { runAnalysis, sendTelegram } from './_analysis.js';

export default async function handler(req, res) {
  const users = await getAllUsers();

  if (users.length === 0) {
    return res.status(200).json({ message: 'No users registered yet.' });
  }

  const summary = [];

  for (const chatId of users) {
    const tickers = await getWatchlist(chatId);
    if (tickers.length === 0) continue;

    try {
      const { message } = await runAnalysis(tickers);
      const header = `🌅 *Good morning! Your daily APEX briefing:*\n\n`;
      await sendTelegram(chatId, header + message);
      summary.push({ chatId, count: tickers.length, ok: true });
    } catch(e) {
      console.error(`Briefing failed for ${chatId}:`, e.message);
      summary.push({ chatId, ok: false, error: e.message });
    }
  }

  res.status(200).json({ ok: true, users: summary });
}
