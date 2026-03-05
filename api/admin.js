// Unified admin endpoint
// POST /api/admin?action=alert       → send Telegram alert
// GET  /api/admin?action=cache-clear → clear cached data for a symbol

import { getClient } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── Alert ────────────────────────────────────────────────────────
  if (action === 'alert') {
    if (req.method !== 'POST') return res.status(405).end();

    const { message, type } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId)
      return res.status(503).json({ error: 'Telegram not configured' });

    const prefix = type === 'buy' ? '🟢' : type === 'sell' ? '🔴' : '🔔';
    const text   = `${prefix} *APEX ALERT*\n${message}\n\n_Sent from your APEX Stock Terminal_`;

    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      const data = await r.json();
      if (!data.ok) return res.status(400).json({ error: data.description });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Cache clear ──────────────────────────────────────────────────
  if (action === 'cache-clear') {
    const { symbol, type = 'all' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    try {
      const redis  = await getClient();
      const types  = type === 'all' ? ['profile', 'metrics', 'quote', 'fmp'] : [type];
      const deleted = [];
      for (const t of types) {
        const key = `apex:cache:${t}:${symbol.toUpperCase()}`;
        const result = await redis.del(key);
        if (result > 0) deleted.push(t);
      }
      return res.status(200).json({ ok: true, symbol, cleared: deleted });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: 'Unknown action. Use ?action=alert or ?action=cache-clear' });
}
