import { addTicker, removeTicker, getWatchlist } from './_redis.js';

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function triggerBriefing(chatId) {
  const list = await getWatchlist();
  if (list.length === 0) {
    await sendTelegram(chatId, '⚠️ Your watchlist is empty. Add stocks with /add AAPL');
    return;
  }
  await sendTelegram(chatId, `⏳ Analysing ${list.length} stocks... this may take a moment.`);

  // Call the watchlist-analyze endpoint
  const baseUrl = `https://${process.env.VERCEL_URL}`;
  const r = await fetch(`${baseUrl}/api/watchlist-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: list }),
  });
  const data = await r.json();
  if (!data.results) {
    await sendTelegram(chatId, '❌ Analysis failed. Please try again.');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const update = req.body;
  const msg    = update?.message;
  if (!msg) return res.status(200).end();

  const chatId = msg.chat.id.toString();
  const text   = (msg.text || '').trim();
  const parts  = text.split(/\s+/);
  const cmd    = parts[0]?.toLowerCase();
  const arg    = parts[1]?.toUpperCase();

  // Security: only respond to your own chat ID
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    await sendTelegram(chatId, '⛔ Unauthorized.');
    return res.status(200).end();
  }

  try {
    if (cmd === '/add' || cmd === '/add@' + process.env.BOT_USERNAME) {
      if (!arg) {
        await sendTelegram(chatId, '⚠️ Usage: /add AAPL');
      } else {
        const list = await addTicker(arg);
        await sendTelegram(chatId, `✅ *${arg}* added to watchlist!\n\nWatchlist (${list.length}):\n${list.map(t => `• ${t}`).join('\n')}\n\nSend /briefing to analyse now.`);
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
        await sendTelegram(chatId, '📋 Your watchlist is empty.\n\nAdd stocks with:\n/add AAPL\n/add TSLA');
      } else {
        await sendTelegram(chatId, `📋 *Watchlist (${list.length})*\n\n${list.map(t => `• ${t}`).join('\n')}\n\nSend /briefing to analyse all.`);
      }

    } else if (cmd === '/briefing') {
      await triggerBriefing(chatId);

    } else if (cmd === '/clear') {
      await saveWatchlist([]);
      await sendTelegram(chatId, '🗑 Watchlist cleared.');

    } else if (cmd === '/help' || cmd === '/start') {
      await sendTelegram(chatId, `👋 *APEX Stock Terminal Bot*\n\nCommands:\n/add AAPL — Add stock to watchlist\n/remove AAPL — Remove stock\n/list — Show your watchlist\n/briefing — Get full analysis now\n/clear — Clear entire watchlist\n\nYou also get an automatic briefing every day at 8AM UTC.`);

    } else {
      await sendTelegram(chatId, `❓ Unknown command. Send /help to see available commands.`);
    }
  } catch (e) {
    console.error('Webhook error:', e);
    await sendTelegram(chatId, `❌ Error: ${e.message}`);
  }

  res.status(200).end();
}
