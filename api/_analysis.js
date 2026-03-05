// ── Shared technical + fundamental analysis ──

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

// ── Sector benchmarks ──
const SECTOR_PE = {
  'Technology':35,'Software':40,'Semiconductors':30,'Internet':45,'Hardware':25,
  'Financial':14,'Banking':12,'Insurance':13,
  'Healthcare':22,'Biotechnology':28,'Pharmaceutical':20,
  'Consumer Cyclical':22,'Retail':20,'Automotive':15,
  'Consumer Defensive':20,'Food':22,'Energy':14,'Oil':13,
  'Utilities':17,'Real Estate':30,'Industrial':20,
  'Aerospace':22,'Materials':18,'Communication':20,
};
const SECTOR_EV = {
  'Technology':20,'Software':22,'Semiconductor':18,'Internet':25,
  'Financial':10,'Banking':9,'Healthcare':14,'Biotechnology':18,
  'Energy':7,'Oil':7,'Utilities':9,'Real Estate':16,
  'Consumer':13,'Retail':11,'Industrial':12,
};
function getSectorMultiple(industry, table, def) {
  if (!industry) return def;
  const key = Object.keys(table).find(k => industry.toLowerCase().includes(k.toLowerCase()));
  return key ? table[key] : def;
}

// ── Intrinsic Value calculation ──
function calcIV(metrics, industry) {
  const eps    = metrics.epsBasicExclExtraAnnual || metrics.epsTTM || 0;
  const bvps   = metrics.bookValuePerShareAnnual || 0;
  const roe    = metrics.roeRfy || metrics.roeTTM || 0;
  const growth = Math.min(Math.max(metrics.revenueGrowth3Y || metrics.epsGrowth3Y || 5, 0), 40);
  const fcfPS  = metrics.freeCashFlowPerShareTTM || 0;
  const ebitda = metrics.ebitdaPerShare || (eps > 0 ? eps * 1.5 : 0);
  const sectorPE = getSectorMultiple(industry, SECTOR_PE, 18);
  const sectorEV = getSectorMultiple(industry, SECTOR_EV, 13);

  const methods = [];

  if (eps > 0 && bvps > 0)
    methods.push(Math.sqrt(22.5 * eps * bvps));

  if (eps > 0 && growth > 0)
    methods.push(eps * (8.5 + 2 * growth) * (4.4 / 4.8));

  const cf = fcfPS > 0 ? fcfPS : eps > 0 ? eps * 0.8 : 0;
  if (cf > 0) {
    const r = 0.09, g = Math.min(growth/100, 0.07);
    const dcf = cf * (1+g) * (1 - Math.pow((1+g)/(1+r), 10)) / (r-g);
    if (dcf > 0 && isFinite(dcf)) methods.push(dcf * 2); // weight DCF double
  }

  if (eps > 0) methods.push(eps * sectorPE * 1.5); // weight sector PE 1.5x

  if (eps > 0 && growth > 0)
    methods.push(eps * Math.min(growth, 50) * 1.5); // PEG weight 1.5x

  if (ebitda > 0) methods.push(ebitda * sectorEV * 1.5); // EV/EBITDA weight 1.5x

  if (bvps > 0 && roe > 0)
    methods.push(bvps * Math.min((roe/100)/0.09, 8));

  if (methods.length === 0) return null;

  const sorted = [...methods].sort((a,b) => a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const filtered = methods.filter(v => v > median/3.5 && v < median*3.5);
  const pool = filtered.length > 0 ? filtered : methods;

  const mid = pool.reduce((s,v) => s+v, 0) / pool.length;
  const lo  = Math.min(...pool);
  const hi  = Math.max(...pool);
  const mos = mid * 0.85;

  return { mid, lo, hi, mos, sectorPE };
}

export function analyzeCandles(candles, currentPrice) {
  const closes = candles.map(d => d.close);
  const rsi    = calcRSI(closes, 14);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);

  const lastRSI = rsi.filter(v => v != null).slice(-1)[0] || 50;
  const lastE20 = ema20.filter(v => v != null).slice(-1)[0];
  const lastE50 = ema50.filter(v => v != null).slice(-1)[0];
  const prevE20 = ema20.filter(v => v != null).slice(-2)[0];
  const prevE50 = ema50.filter(v => v != null).slice(-2)[0];

  const recent  = candles.slice(-20);
  const lows    = recent.map(d => d.low).sort((a,b) => a-b);
  const highs   = recent.map(d => d.high).sort((a,b) => b-a);
  const support = lows[Math.floor(lows.length * 0.2)];
  const resist  = highs[Math.floor(highs.length * 0.2)];

  let buyScore = 0, sellScore = 0;
  const reasons = [];

  if (lastRSI < 30)      { buyScore  += 2; reasons.push(`RSI ${lastRSI.toFixed(1)} — oversold`); }
  else if (lastRSI < 40) { buyScore  += 1; reasons.push(`RSI ${lastRSI.toFixed(1)} — approaching oversold`); }
  else if (lastRSI > 70) { sellScore += 2; reasons.push(`RSI ${lastRSI.toFixed(1)} — overbought`); }
  else if (lastRSI > 60) { sellScore += 1; reasons.push(`RSI ${lastRSI.toFixed(1)} — approaching overbought`); }

  if (lastE20 && lastE50 && prevE20 && prevE50) {
    if (prevE20 <= prevE50 && lastE20 > lastE50) { buyScore  += 2; reasons.push('EMA20 crossed above EMA50'); }
    if (prevE20 >= prevE50 && lastE20 < lastE50) { sellScore += 2; reasons.push('EMA20 crossed below EMA50'); }
    if (lastE20 > lastE50) { buyScore  += 1; reasons.push('EMA20 above EMA50 — uptrend'); }
    if (lastE20 < lastE50) { sellScore += 1; reasons.push('EMA20 below EMA50 — downtrend'); }
  }

  const distToSupport = ((currentPrice - support) / currentPrice * 100);
  const distToResist  = ((resist - currentPrice) / currentPrice * 100);
  if (distToSupport < 3) { buyScore  += 1; reasons.push(`Near support $${support.toFixed(2)}`); }
  if (distToResist  < 3) { sellScore += 1; reasons.push(`Near resistance $${resist.toFixed(2)}`); }

  let signal = 'HOLD';
  if (buyScore >= 3 && buyScore > sellScore)       signal = 'BUY';
  else if (sellScore >= 3 && sellScore > buyScore) signal = 'SELL';
  else if (buyScore > sellScore)                   signal = 'WATCH';

  return { signal, buyScore, sellScore, reasons, rsi: lastRSI, support, resist, ema20: lastE20, ema50: lastE50 };
}

export async function fetchCandles(symbol) {
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

export async function fetchQuote(symbol) {
  // Twelve Data quote
  const r = await fetch(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
  );
  const d = await r.json();
  if (d.status === 'error') throw new Error(d.message);
  return { c: parseFloat(d.close), pc: parseFloat(d.previous_close), o: parseFloat(d.open), h: parseFloat(d.high), l: parseFloat(d.low) };
}

export async function fetchFundamentals(symbol) {
  // Yahoo Finance fundamentals (no key needed)
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,financialData,summaryDetail,assetProfile`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const res = d?.quoteSummary?.result?.[0] || {};
    const ks  = res.defaultKeyStatistics || {};
    const fd  = res.financialData || {};
    const sd  = res.summaryDetail || {};
    const ap  = res.assetProfile || {};
    return {
      eps:      ks.trailingEps?.raw || 0,
      bvps:     ks.bookValue?.raw || 0,
      pe:       sd.trailingPE?.raw || 0,
      growth:   fd.revenueGrowth?.raw ? fd.revenueGrowth.raw * 100 : (fd.earningsGrowth?.raw ? fd.earningsGrowth.raw * 100 : 5),
      fcfPS:    (fd.freeCashflow?.raw && ks.sharesOutstanding?.raw) ? fd.freeCashflow.raw / ks.sharesOutstanding.raw : 0,
      ebitda:   (fd.ebitda?.raw && ks.sharesOutstanding?.raw) ? fd.ebitda.raw / ks.sharesOutstanding.raw : 0,
      roe:      fd.returnOnEquity?.raw ? fd.returnOnEquity.raw * 100 : 0,
      industry: ap.industry || ap.sector || '',
    };
  } catch(e) {
    return { eps:0, bvps:0, pe:0, growth:5, fcfPS:0, ebitda:0, roe:0, industry:'' };
  }
}

export async function sendTelegram(chatId, message) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId || process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
}

export async function runAnalysis(tickers) {
  const emoji = { BUY:'🟢', SELL:'🔴', HOLD:'⚪', WATCH:'🟡', ERROR:'⛔' };
  const results = [];

  for (const ticker of tickers) {
    try {
      const [quote, candles, fund] = await Promise.all([
        fetchQuote(ticker),
        fetchCandles(ticker),
        fetchFundamentals(ticker),
      ]);
      if (!quote.c || !candles) { results.push({ ticker, signal:'ERROR', error:'No data' }); continue; }

      const analysis = analyzeCandles(candles, quote.c);
      const chg      = ((quote.c - quote.pc) / quote.pc * 100);
      const iv       = calcIV(fund, fund.industry);

      results.push({ ticker, price:quote.c, change:chg, fund, iv, ...analysis });
    } catch(e) {
      results.push({ ticker, signal:'ERROR', error:e.message });
    }
  }

  const lines = results.map(r => {
    if (r.signal === 'ERROR') return `${emoji.ERROR} *${r.ticker}* — Error: ${r.error}`;

    const chgStr = (r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%';
    const topReasons = r.reasons.slice(0, 2).join(' · ') || 'Neutral momentum';

    // IV section
    let ivLine = '';
    if (r.iv) {
      const marginPct = ((r.iv.mid - r.price) / r.price * 100);
      const ivVerdict = marginPct > 10 ? '🟢 UNDERVALUED'
        : marginPct > 3  ? '🟡 SLIGHT DISCOUNT'
        : marginPct < -15 ? '🔴 OVERVALUED'
        : marginPct < -5  ? '🟠 SLIGHT PREMIUM'
        : '⚪ FAIR VALUE';
      ivLine = `IV Range: $${r.iv.lo.toFixed(0)}–$${r.iv.hi.toFixed(0)} | Mid: $${r.iv.mid.toFixed(0)} ${ivVerdict}\nMOS Buy Zone: ≤$${r.iv.mos.toFixed(0)} (15% discount)`;
    }

    return [
      `${emoji[r.signal] || '⚪'} *${r.ticker}* — ${r.signal}`,
      `Price: $${r.price.toFixed(2)} (${chgStr})`,
      topReasons,
      `Support: $${r.support?.toFixed(2)} | Resistance: $${r.resist?.toFixed(2)}`,
      ivLine,
    ].filter(Boolean).join('\n');
  });

  const message = `📊 *APEX DAILY BRIEFING*\n${new Date().toDateString()}\n\n${lines.join('\n\n')}`;
  return { results, message };
}
