import { getWatchlist, addTicker, removeTicker, clearWatchlist, registerUser, getAllUsers, getUserProfile, getClient } from './_redis.js';
import { runAnalysis, sendTelegram, formatStockBlock } from './_analysis.js';

const OWNER_ID = process.env.TELEGRAM_CHAT_ID;

async function acquireLock(chatId) {
  try {
    const redis = await getClient();
    const key   = `apex:lock:briefing:${chatId}`;
    // NX = only set if not exists, EX = expire after 10 min (safety fallback)
    const result = await redis.set(key, '1', { NX: true, EX: 600 });
    return result === 'OK'; // true = lock acquired, false = already locked
  } catch(e) { return true; } // fail open — allow if Redis error
}

async function releaseLock(chatId) {
  try {
    const redis = await getClient();
    await redis.del(`apex:lock:briefing:${chatId}`);
  } catch(e) { /* non-fatal */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const msg = req.body?.message;
  console.log('WEBHOOK body keys:', Object.keys(req.body || {}), 'msg:', !!msg, 'text:', msg?.text);
  if (!msg) return res.status(200).end();

  const chatId = msg.chat.id.toString();
  const from   = msg.from || {};
  const text   = (msg.text || '').trim();
  const parts  = text.split(/\s+/);
  const cmd    = parts[0]?.toLowerCase().split('@')[0];
  const arg    = parts[1]?.toUpperCase();

  // Always do all work first, then respond 200 at the end.
  // Vercel functions stay alive until res.end() is called.
  // For /briefing (long-running), we respond 200 AFTER sending the first
  // Telegram message so Telegram stops waiting, but Vercel keeps running.
  try {
    await registerUser(chatId, from);
  } catch(e) { console.error('registerUser error:', e.message); }

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
        const currentList = await getWatchlist(chatId);
        if (currentList.length >= 10) {
          await sendTelegram(chatId,
            `⚠️ <b>Watchlist full (10/10)</b>\n\n` +
            `You've reached the maximum of 10 stocks.\n` +
            `Remove a stock first with /remove AAPL before adding a new one.\n\n` +
            `Your current watchlist:\n${currentList.map(t => `• ${t}`).join('\n')}`
          );
        } else {
          await sendTelegram(chatId, `⏳ Verifying <b>${arg}</b>...`);
          try {
            const r = await fetch(
              `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(arg)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
            );
            const d = await r.json();
            if (d.status === 'error') throw new Error('Ticker not found');
            const list = await addTicker(chatId, arg);
            const remaining = 10 - list.length;
            await sendTelegram(chatId,
              `✅ <b>${arg}</b> added to your watchlist!\n\n` +
              `Your watchlist (${list.length}/10):\n${list.map(t => `• ${t}`).join('\n')}\n\n` +
              `${remaining > 0 ? `${remaining} slot${remaining > 1 ? 's' : ''} remaining.` : `⚠️ Watchlist full — remove a stock to add more.`}\n\n` +
              `Send /briefing to analyse now.`
            );
          } catch(e) {
            await sendTelegram(chatId, `❌ <b>${arg}</b> not found. Check the ticker symbol.`);
          }
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
        // ── Redis lock — prevent duplicate runs from Telegram retries ──
        const locked = await acquireLock(chatId);
        console.log('BRIEFING lock acquired:', locked, 'chatId:', chatId);
        if (!locked) {
          await sendTelegram(chatId, `⏳ A briefing is already running. Please wait for it to finish.\n\nIf stuck, send /unlock to reset.`);
          return;
        }

        try {
          const estSecs = list.length * 8;
          const estStr  = estSecs < 60 ? `~${estSecs}s` : `~${Math.ceil(estSecs/60)} min`;
          await sendTelegram(chatId, `📊 <b>APEX BRIEFING</b> — ${new Date().toDateString()}\n\n⏳ Analysing ${list.length} stock${list.length>1?'s':''} (${estStr})...\nEach result will appear as it's ready.`);

          // Fire-and-forget to separate long-running function
          // Use a short timeout so webhook doesn't wait — run-briefing runs independently
          const host = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'https://apex-stocks.vercel.app';
          fetch(`${host}/api/run-briefing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId }),
            signal: AbortSignal.timeout(500), // don't wait — fire and forget
          }).catch(() => {}); // ignore timeout/errors — it's running independently

        } catch(e) {
          console.error('briefing launch error:', e.message);
          await sendTelegram(chatId, `❌ Failed to start briefing: ${e.message}`);
          await releaseLock(chatId);
        }
      }

    } else if (cmd === '/unlock') {
      await releaseLock(chatId);
      await sendTelegram(chatId, `🔓 Briefing lock cleared. You can now run /briefing again.`);

    } else if (cmd === '/clear') {
      await clearWatchlist(chatId);
      await sendTelegram(chatId, '🗑 Your watchlist has been cleared.');

    } else if (cmd === '/users') {
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
    try { await sendTelegram(chatId, `❌ Something went wrong: ${e.message}`); } catch(_) {}
    await releaseLock(chatId);
  }

  // Send 200 if not already sent (briefing sends it earlier)
  if (!res.headersSent) res.status(200).end();
}
