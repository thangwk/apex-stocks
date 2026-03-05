import { getWatchlist, addTicker, removeTicker, clearWatchlist } from './_redis.js';
import { runAnalysis, sendTelegram } from './_analysis.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const msg = req.body?.message;
  if (!msg)  return res.status(200).end();

  const chatId = msg.chat.id.toString();
  const text   = (msg.text || '').trim();
  const parts  = text.split(/\s+/);
  const cmd    = parts[0]?.toLowerCase().split('@')[0]; // strip @botname suffix
  const arg    = parts[1]?.toUpperCase();

  try {
    if (cmd === '/start' || cmd === '/help') {
      await sendTelegram(chatId,
        `👋 *Welcome to APEX Stock Bot*\n\n` +
        `Your personal stock watchlist & briefing service.\n\n` +
        `🌐 *Web App:* https://apex-stocks.vercel.app\n\n` +
        `*Commands:*\n` +
        `/add AAPL — Add stock to your watchlist\n` +
        `/remove AAPL — Remove stock\n` +
        `/list — Show your watchlist\n` +
        `/briefing — Full analysis with intrinsic value\n` +
        `/clear — Clear your entire watchlist\n\n` +
        `You'll also receive an automatic briefing every day at 8AM UTC.`
      );

    } else if (cmd === '/add') {
      if (!arg) {
        await sendTelegram(chatId, '⚠️ Usage: /add AAPL');
      } else {
        await sendTelegram(chatId, `⏳ Verifying *${arg}*...`);
        // Quick verify ticker exists
        try {
          const r = await fetch(
            `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(arg)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
          );
          const d = await r.json();
          if (d.status === 'error') throw new Error('Ticker not found');
          const list = await addTicker(chatId, arg);
          await sendTelegram(chatId,
            `✅ *${arg}* added to your watchlist!\n\n` +
            `Your watchlist (${list.length}):\n${list.map(t => `• ${t}`).join('\n')}\n\n` +
            `Send /briefing to analyse now.`
          );
        } catch(e) {
          await sendTelegram(chatId, `❌ *${arg}* not found. Check the ticker symbol.`);
        }
      }

    } else if (cmd === '/remove') {
      if (!arg) {
        await sendTelegram(chatId, '⚠️ Usage: /remove AAPL');
      } else {
        const list = await removeTicker(chatId, arg);
        await sendTelegram(chatId,
          `🗑 *${arg}* removed.\n\n` +
          `Your watchlist (${list.length}):\n` +
          (list.length ? list.map(t => `• ${t}`).join('\n') : '_(empty)_')
        );
      }

    } else if (cmd === '/list') {
      const list = await getWatchlist(chatId);
      if (list.length === 0) {
        await sendTelegram(chatId, `📋 Your watchlist is empty.\n\nAdd stocks with:\n/add AAPL`);
      } else {
        await sendTelegram(chatId,
          `📋 *Your Watchlist (${list.length})*\n\n${list.map(t => `• ${t}`).join('\n')}\n\nSend /briefing to analyse all.`
        );
      }

    } else if (cmd === '/briefing') {
      const list = await getWatchlist(chatId);
      if (list.length === 0) {
        await sendTelegram(chatId, `⚠️ Your watchlist is empty.\n\nAdd stocks with /add AAPL`);
      } else {
        await sendTelegram(chatId, `⏳ Analysing ${list.length} stock(s)...\nThis may take up to 30 seconds.`);
        const { message } = await runAnalysis(list);
        await sendTelegram(chatId, message);
      }

    } else if (cmd === '/clear') {
      await clearWatchlist(chatId);
      await sendTelegram(chatId, '🗑 Your watchlist has been cleared.');

    } else {
      await sendTelegram(chatId, `❓ Unknown command. Send /help to see available commands.`);
    }

  } catch(e) {
    console.error('Webhook error:', e);
    await sendTelegram(chatId, `❌ Something went wrong: ${e.message}`);
  }

  res.status(200).end();
}
