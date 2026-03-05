// Shared technical analysis logic (mirrors frontend calculations)
function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const out = new Array(data.length).fill(null);
  if (data.length < period) return out;
  out[period - 1] = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) out[i] = data[i] * k + out[i-1] * (1-k);
  return out;
}

function calcRSI(data, period = 14) {
  const out = new Array(data.length).fill(null);
  if (data.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = data[i]-data[i-1]; if (d>0) g+=d; else l-=d; }
  let ag = g/period, al = l/period;
  out[period] = 100 - 100/(1 + ag/Math.max(al, 1e-9));
  for (let i = period+1; i < data.length; i++) {
    const d = data[i]-data[i-1];
    ag = (ag*(period-1)+(d>0?d:0))/period;
    al = (al*(period-1)+(d<0?-d:0))/period;
    out[i] = 100 - 100/(1 + ag/Math.max(al, 1e-9));
  }
  return out;
}

function analyzeCandles(candles, currentPrice) {
  const closes = candles.map(d => d.close);
  const rsi    = calcRSI(closes, 14);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);

  const lastRSI  = rsi.filter(v => v != null).slice(-1)[0] || 50;
  const lastE20  = ema20.filter(v => v != null).slice(-1)[0];
  const lastE50  = ema50.filter(v => v != null).slice(-1)[0];
  const prevE20  = ema20.filter(v => v != null).slice(-2)[0];
  const prevE50  = ema50.filter(v => v != null).slice(-2)[0];

  // Support = recent swing lows, Resistance = recent swing highs
  const recent   = candles.slice(-20);
  const lows     = recent.map(d => d.low).sort((a,b)=>a-b);
  const highs    = recent.map(d => d.high).sort((a,b)=>b-a);
  const support  = lows[Math.floor(lows.length * 0.2)];
  const resist   = highs[Math.floor(highs.length * 0.2)];

  // Score signals
  let buyScore = 0, sellScore = 0;
  const reasons = [];

  // RSI
  if (lastRSI < 30)      { buyScore  += 2; reasons.push(`RSI ${lastRSI.toFixed(1)} — oversold`); }
  else if (lastRSI < 40) { buyScore  += 1; reasons.push(`RSI ${lastRSI.toFixed(1)} — approaching oversold`); }
  else if (lastRSI > 70) { sellScore += 2; reasons.push(`RSI ${lastRSI.toFixed(1)} — overbought`); }
  else if (lastRSI > 60) { sellScore += 1; reasons.push(`RSI ${lastRSI.toFixed(1)} — approaching overbought`); }

  // EMA cross
  if (lastE20 && lastE50 && prevE20 && prevE50) {
    if (prevE20 <= prevE50 && lastE20 > lastE50) { buyScore  += 2; reasons.push('EMA20 crossed above EMA50'); }
    if (prevE20 >= prevE50 && lastE20 < lastE50) { sellScore += 2; reasons.push('EMA20 crossed below EMA50'); }
    if (lastE20 > lastE50)  { buyScore  += 1; reasons.push('EMA20 above EMA50 — uptrend'); }
    if (lastE20 < lastE50)  { sellScore += 1; reasons.push('EMA20 below EMA50 — downtrend'); }
  }

  // Price vs support/resistance
  const distToSupport = ((currentPrice - support) / currentPrice * 100);
  const distToResist  = ((resist - currentPrice) / currentPrice * 100);
  if (distToSupport < 3)  { buyScore  += 1; reasons.push(`Near support $${support.toFixed(2)}`); }
  if (distToResist  < 3)  { sellScore += 1; reasons.push(`Near resistance $${resist.toFixed(2)}`); }

  // Verdict
  let signal = 'HOLD';
  if (buyScore >= 3 && buyScore > sellScore)       signal = 'BUY';
  else if (sellScore >= 3 && sellScore > buyScore) signal = 'SELL';
  else if (buyScore > sellScore)                   signal = 'WATCH';

  return { signal, buyScore, sellScore, reasons, rsi: lastRSI, support, resist, ema20: lastE20, ema50: lastE50 };
}

async function fetchCandles(symbol) {
  const r = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=60&apikey=${process.env.TWELVE_DATA_API_KEY}`
  );
  const data = await r.json();
  if (!data.values) return null;
  return data.values.reverse().map(v => ({
    date:   v.datetime,
    open:   parseFloat(v.open),
    high:   parseFloat(v.high),
    low:    parseFloat(v.low),
    close:  parseFloat(v.close),
    volume: parseInt(v.volume) || 0,
  }));
}

async function fetchQuote(symbol) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`
  );
  return r.json();
}

async function sendTelegram(message) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { tickers } = req.body || {};
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'tickers array required' });
  }

  const results = [];

  for (const ticker of tickers) {
    try {
      const [quote, candles] = await Promise.all([
        fetchQuote(ticker),
        fetchCandles(ticker),
      ]);

      if (!quote.c || !candles) {
        results.push({ ticker, signal: 'ERROR', error: 'No data' });
        continue;
      }

      const analysis = analyzeCandles(candles, quote.c);
      const chg      = ((quote.c - quote.pc) / quote.pc * 100);

      results.push({
        ticker,
        price:    quote.c,
        change:   chg,
        ...analysis,
      });
    } catch (e) {
      results.push({ ticker, signal: 'ERROR', error: e.message });
    }
  }

  // Build Telegram message
  const emoji = { BUY: '🟢', SELL: '🔴', HOLD: '⚪', WATCH: '🟡', ERROR: '⛔' };
  const lines = results.map(r => {
    if (r.signal === 'ERROR') return `${emoji.ERROR} *${r.ticker}* — Error: ${r.error}`;
    const chgStr = (r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%';
    const topReasons = r.reasons.slice(0, 2).join(' · ');
    return [
      `${emoji[r.signal] || '⚪'} *${r.ticker}* — ${r.signal}`,
      `Price: $${r.price.toFixed(2)} (${chgStr})`,
      `${topReasons}`,
      `Support: $${r.support?.toFixed(2)} | Resistance: $${r.resist?.toFixed(2)}`,
    ].join('\n');
  });

  const message = `📊 *APEX WATCHLIST BRIEFING*\n${new Date().toDateString()}\n\n${lines.join('\n\n')}`;

  try {
    await sendTelegram(message);
  } catch(e) {
    console.error('Telegram send failed:', e.message);
  }

  res.status(200).json({ results });
}
