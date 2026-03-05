import { getWatchlist, addTicker, removeTicker, saveWatchlist } from './_redis.js';
import { runAnalysis, sendTelegram } from './_analysis.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const msg  = req.body?.message;
  if (!msg)  return res.status(200).end();

  const chatId = msg.chat.id.toString();
  const text   = (msg.text || '').trim();
  const parts  = text.split(/\s+/);
  const cmd    = parts[0]?.toLowerCase();
  const arg    = parts[1]?.toUpperCase();

  // Only respond to your chat
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    await sendTelegram(chatId, '⛔ Unauthorized.');
    return res.status(200).end();
  }

  try {
    if (cmd === '/add') {
      if (!arg) {
        await sendTelegram(chatId, '⚠️ Usage: /add AAPL');
      } else {
        const list = await addTicker(arg);
        await sendTelegram(chatId, `✅ *${arg}* added!\n\nWatchlist (${list.length}):\n${list.map(t => `• ${t}`).join('\n')}\n\nSend /briefing to analyse now.`);
      }

    } else if (cmd === '/remove') {
      if (!arg) {
        await sendTelegram(chatId, '⚠️ Usage: /remove AAPL');
      } else {
        const list = await removeTicker(arg);
        await sendTelegram(chatId, `🗑 *${arg}* removed.\n\nWatchlist (${list.length}):\n${list.length ? list.map(t => `• ${t}`).join('\n') : '_(empty)_'}`);
      }

    } else if (cmd === '/list') {
      const list = await getWatchlist();
      if (list.length === 0) {
        await sendTelegram(chatId, '📋 Watchlist is empty.\n\nAdd stocks with:\n/add AAPL');
      } else {
        await sendTelegram(chatId, `📋 *Watchlist (${list.length})*\n\n${list.map(t => `• ${t}`).join('\n')}\n\nSend /briefing to analyse all.`);
      }

    } else if (cmd === '/briefing') {
      const list = await getWatchlist();
      if (list.length === 0) {
        await sendTelegram(chatId, '⚠️ Watchlist is empty. Add stocks with /add AAPL');
      } else {
        await sendTelegram(chatId, `⏳ Analysing ${list.length} stock(s)...`);
        const { message } = await runAnalysis(list);
        await sendTelegram(chatId, message);
      }

    } else if (cmd === '/clear') {
      await saveWatchlist([]);
      await sendTelegram(chatId, '🗑 Watchlist cleared.');

    } else {
      await sendTelegram(chatId, `👋 *APEX Stock Bot*\n\n/add AAPL — Add stock\n/remove AAPL — Remove stock\n/list — Show watchlist\n/briefing — Analyse all now\n/clear — Clear watchlist`);
    }
  } catch(e) {
    console.error('Webhook error:', e);
    await sendTelegram(chatId, `❌ Error: ${e.message}`);
  }

  res.status(200).end();
}
