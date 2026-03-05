import { getWatchlist, addTicker, removeTicker, clearWatchlist, registerUser, getAllUsers, getUserProfile } from './_redis.js';
import { runAnalysis, sendTelegram } from './_analysis.js';

const OWNER_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const msg = req.body?.message;
  if (!msg)  return res.status(200).end();

  const chatId = msg.chat.id.toString();
  const from   = msg.from || {};
  const text   = (msg.text || '').trim();
  const parts  = text.split(/\s+/);
  const cmd    = parts[0]?.toLowerCase().split('@')[0];
  const arg    = parts[1]?.toUpperCase();

  // Register/update user profile on every message
  await registerUser(chatId, from);

  try {
    if (cmd === '/start' || cmd === '/help') {
      await sendTelegram(chatId,
        `👋 <b>Welcome to APEX Stock Bot</b>\n\n` +
        `Your personal stock watchlist &amp; briefing service.\n\n` +
        `🌐 <a href="https://apex-stocks.vercel.app">Open APEX Web App</a>\n\n` +
        `<b>Commands:</b>\n` +
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
        await sendTelegram(chatId, `⏳ Verifying <b>${arg}</b>...`);
        try {
          const r = await fetch(
            `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(arg)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
          );
          const d = await r.json();
          if (d.status === 'error') throw new Error('Ticker not found');
          const list = await addTicker(chatId, arg);
          await sendTelegram(chatId,
            `✅ <b>${arg}</b> added to your watchlist!\n\n` +
            `Your watchlist (${list.length}):\n${list.map(t => `• ${t}`).join('\n')}\n\n` +
            `Send /briefing to analyse now.`
          );
        } catch(e) {
          await sendTelegram(chatId, `❌ <b>${arg}</b> not found. Check the ticker symbol.`);
        }
      }

    } else if (cmd === '/remove') {
      if (!arg) {
        await sendTelegram(chatId, '⚠️ Usage: /remove AAPL');
      } else {
        const list = await removeTicker(chatId, arg);
        await sendTelegram(chatId,
          `🗑 <b>${arg}</b> removed.\n\n` +
          `Your watchlist (${list.length}):\n` +
          (list.length ? list.map(t => `• ${t}`).join('\n') : '<i>(empty)</i>')
        );
      }

    } else if (cmd === '/list') {
      const list = await getWatchlist(chatId);
      if (list.length === 0) {
        await sendTelegram(chatId, `📋 Your watchlist is empty.\n\nAdd stocks with:\n/add AAPL`);
      } else {
        await sendTelegram(chatId,
          `📋 <b>Your Watchlist (${list.length})</b>\n\n${list.map(t => `• ${t}`).join('\n')}\n\nSend /briefing to analyse all.`
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

    } else if (cmd === '/users') {
      // Admin only
      if (chatId !== OWNER_ID) {
        await sendTelegram(chatId, `❌ Not authorised.`);
      } else {
        const userIds = await getAllUsers();
        if (userIds.length === 0) {
          await sendTelegram(chatId, '👥 No users yet.');
        } else {
          const lines = await Promise.all(userIds.map(async (id) => {
            const profile  = await getUserProfile(id);
            const tickers  = await getWatchlist(id);
            const name     = profile?.username
              ? `@${profile.username}`
              : profile?.firstName
              ? profile.firstName + (profile.lastName ? ' ' + profile.lastName : '')
              : `User ${id}`;
            const you      = id === OWNER_ID ? ' 👑' : '';
            const stocks   = tickers.length > 0 ? tickers.join(', ') : 'empty';
            const lastSeen = profile?.lastSeen
              ? new Date(profile.lastSeen).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
              : 'unknown';
            return `• <b>${name}</b>${you}\n  Watchlist: ${stocks}\n  Last seen: ${lastSeen}`;
          }));

          await sendTelegram(chatId,
            `👥 <b>APEX Users (${userIds.length})</b>\n\n${lines.join('\n\n')}`
          );
        }
      }

    } else {
      await sendTelegram(chatId, `❓ Unknown command. Send /help to see available commands.`);
    }

  } catch(e) {
    console.error('Webhook error:', e);
    await sendTelegram(chatId, `❌ Something went wrong: ${e.message}`);
  }

  res.status(200).end();
}
