// Separate long-running function for briefing analysis
// Called by telegram-webhook with fire-and-forget — runs independently with its own 5min timeout
import { getWatchlist, getClient } from './_redis.js';
import { runAnalysis, sendTelegram, formatStockBlock } from './_analysis.js';

async function releaseLock(chatId) {
  try {
    const redis = await getClient();
    await redis.del(`apex:lock:briefing:${chatId}`);
  } catch(e) { /* non-fatal */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'missing chatId' });

  // Respond immediately so the calling webhook doesn't wait
  res.status(200).json({ started: true });

  // Now do the long work — Vercel keeps this function alive until it completes (up to 5 min)
  try {
    const list = await getWatchlist(chatId);
    if (!list.length) return;

    const onResult = async (result) => {
      await sendTelegram(chatId, formatStockBlock(result));
    };

    const { footer } = await runAnalysis(list, onResult);
    await sendTelegram(chatId, footer);
  } catch(e) {
    console.error('run-briefing error:', e.message);
    try { await sendTelegram(chatId, `❌ Briefing failed: ${e.message}`); } catch(_) {}
  } finally {
    await releaseLock(chatId);
  }
}
