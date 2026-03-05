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

// ── Sector multiples ──
const SECTOR_PE   = { 'Technology':35,'Software':40,'Semiconductors':30,'Internet':45,'Hardware':25,'Financial':14,'Banking':12,'Insurance':13,'Healthcare':22,'Biotechnology':28,'Pharmaceutical':20,'Consumer Cyclical':22,'Retail':20,'Automotive':15,'Consumer Defensive':20,'Food':22,'Energy':14,'Oil':13,'Utilities':17,'Real Estate':30,'Industrial':20,'Aerospace':22,'Materials':18,'Communication':20 };
const SECTOR_PFCF = { 'Technology':35,'Software':40,'Semiconductors':28,'Internet':45,'Financial':12,'Banking':10,'Healthcare':20,'Biotechnology':25,'Energy':10,'Oil':9,'Utilities':12,'Real Estate':18,'Consumer':16,'Retail':14,'Industrial':15 };
const SECTOR_EV   = { 'Technology':25,'Software':30,'Semiconductors':22,'Internet':35,'Financial':10,'Banking':9,'Healthcare':14,'Biotechnology':20,'Energy':7,'Oil':7,'Utilities':9,'Real Estate':18,'Consumer':13,'Retail':11,'Industrial':12 };

function getSectorMultiple(industry, table, def) {
  if (!industry) return def;
  const key = Object.keys(table).find(k => industry.toLowerCase().includes(k.toLowerCase()));
  return key ? table[key] : def;
}

// ── Intrinsic Value ──────────────────────────────────────────────
export function calcIV(m, industry, fmp) {
  const sectorPE   = getSectorMultiple(industry, SECTOR_PE, 18);
  const sectorPFCF = getSectorMultiple(industry, SECTOR_PFCF, 18);
  const sectorEV   = getSectorMultiple(industry, SECTOR_EV, 14);

  const epsGAAP  = m.epsBasicExclExtraAnnual || m.epsTTM || 0;
  const epsTTM   = m.epsTTM || epsGAAP;
  const bvps     = m.bookValuePerShareAnnual || 0;
  const roe      = m.roeRfy || m.roeTTM || 0;
  const fcfPS    = m.cashFlowPerShareTTM || m.freeCashFlowPerShareTTM || 0;
  const ebitdaPS = m.ebitdPerShareTTM || m.ebitdPerShareAnnual || m.ebitdaPerShare || 0;
  const evEbitda = m.evEbitdaTTM || 0;
  const revenuePS= m.revenuePerShareTTM || m.revenuePerShareAnnual || 0;
  const psRatio  = m.psTTM || 0;
  const fwdPE    = m.forwardPE || 0;

  // Best growth: highest of rev3Y, eps3Y, avg(TTM rev+eps)
  const growth = Math.min(Math.max(
    m.revenueGrowth3Y || 0, m.epsGrowth3Y || 0,
    ((m.epsGrowthTTMYoy || 0) + (m.revenueGrowthTTMYoy || 0)) / 2, 3
  ), 50);
  const highGrowth = growth > 15;
  const earningsPS = fcfPS > 0 ? fcfPS : epsGAAP;

  const methods = [];

  // FMP DCF — professionally computed from SEC filings, highest weight
  if (fmp?.dcf && fmp.dcf > 0)
    methods.push({ name:'FMP DCF', value:fmp.dcf, weight:3 });

  // DCF on FCF
  if (fcfPS > 0) {
    const r = 0.09, g = Math.min(growth/100, highGrowth ? 0.12 : 0.08);
    const v = fcfPS * (1+g) * (1 - Math.pow((1+g)/(1+r), 10)) / (r-g);
    if (v > 0 && isFinite(v)) methods.push({ name:'DCF/FCF', value:v, weight:2.5 });
  } else if (epsGAAP > 0) {
    const r = 0.09, g = Math.min(growth/100, 0.08);
    const v = epsGAAP * 0.8 * (1+g) * (1 - Math.pow((1+g)/(1+r), 10)) / (r-g);
    if (v > 0 && isFinite(v)) methods.push({ name:'DCF/EPS', value:v, weight:1.5 });
  }

  // Forward P/E
  if (fwdPE > 0 && epsTTM > 0)
    methods.push({ name:'Fwd P/E', value:epsTTM * fwdPE * 0.85, weight:2 });

  // P/FCF
  if (fcfPS > 0) methods.push({ name:'P/FCF', value:fcfPS * sectorPFCF, weight:2 });

  // EV/EBITDA
  if (ebitdaPS > 0) {
    const fairEV = evEbitda > 0 ? Math.min(sectorEV, evEbitda * 0.9) : sectorEV;
    methods.push({ name:'EV/EBITDA', value:ebitdaPS * fairEV, weight:2 });
  }

  // Sector P/E
  if (earningsPS > 0) methods.push({ name:'Sector P/E', value:earningsPS * sectorPE, weight:1.5 });

  // PEG (only if growth > 5%)
  if (earningsPS > 0 && growth > 5) {
    const fairPE = Math.min(growth * 1.5, 60);
    methods.push({ name:'PEG', value:earningsPS * fairPE, weight:1 });
  }

  // P/S for tech stocks
  if (revenuePS > 0 && (highGrowth || ['Technology','Software','Internet','Semiconductor'].some(s => industry.includes(s)))) {
    const fairPS = Math.min(psRatio > 0 ? psRatio * 0.8 : sectorEV * 0.4, 20);
    if (fairPS > 0) methods.push({ name:'P/S', value:revenuePS * fairPS, weight:1 });
  }

  // Graham (mature/value only — skip if high ROE like AAPL)
  if (epsGAAP > 0 && bvps > 5 && !highGrowth && roe < 50)
    methods.push({ name:'Graham', value:Math.sqrt(22.5 * epsGAAP * bvps), weight:0.5 });

  // P/B with capped ROE
  if (bvps > 0 && roe > 0) {
    const cappedROE = Math.min(roe, 50);
    const fairPB = Math.min((cappedROE/100)/0.09, 8);
    methods.push({ name:'P/B', value:bvps * fairPB, weight:0.5 });
  }

  if (methods.length === 0) return null;

  const vals   = methods.map(x => x.value).sort((a,b) => a-b);
  const median = vals[Math.floor(vals.length/2)];
  const pool   = methods.filter(x => x.value > 0 && x.value < median*4 && x.value > median/4);
  const final  = pool.length > 0 ? pool : methods;

  const totalW = final.reduce((s,x) => s+x.weight, 0);
  const mid    = final.reduce((s,x) => s+x.value*x.weight, 0) / totalW;
  const lo     = Math.min(...final.map(x => x.value));
  const hi     = Math.max(...final.map(x => x.value));
  const mos    = mid * 0.85;

  return { mid, lo, hi, mos };
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

  if ((currentPrice - support) / currentPrice * 100 < 3) { buyScore  += 1; reasons.push(`Near support $${support.toFixed(2)}`); }
  if ((resist - currentPrice) / currentPrice * 100 < 3)  { sellScore += 1; reasons.push(`Near resistance $${resist.toFixed(2)}`); }

  let signal = 'HOLD';
  if (buyScore >= 3 && buyScore > sellScore)       signal = 'BUY';
  else if (sellScore >= 3 && sellScore > buyScore) signal = 'SELL';
  else if (buyScore > sellScore)                   signal = 'WATCH';

  return { signal, reasons, rsi: lastRSI, support, resist };
}

export async function fetchCandles(symbol) {
  const r = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=60&apikey=${process.env.TWELVE_DATA_API_KEY}`
  );
  const data = await r.json();
  if (!data.values) return null;
  return data.values.reverse().map(v => ({
    date:v.datetime, open:parseFloat(v.open), high:parseFloat(v.high),
    low:parseFloat(v.low), close:parseFloat(v.close), volume:parseInt(v.volume)||0,
  }));
}

export async function fetchQuote(symbol) {
  try {
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('quote', symbol);
    if (cached) return cached;

    const r = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const d = await r.json();
    if (d.status === 'error') throw new Error(d.message);
    const result = { c:parseFloat(d.close), pc:parseFloat(d.previous_close), o:parseFloat(d.open), h:parseFloat(d.high), l:parseFloat(d.low) };
    await setCache('quote', symbol, result, TTL.QUOTE);
    return result;
  } catch(e) { throw e; }
}

export async function fetchFundamentals(symbol) {
  try {
    // Check cache first
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('metrics', symbol);
    if (cached) return cached;

    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${process.env.FINNHUB_API_KEY}`,
    );
    const d = await r.json();
    const metric = d.metric || {};
    if (Object.keys(metric).length > 0) await setCache('metrics', symbol, metric, TTL.METRICS);
    return metric;
  } catch(e) { return {}; }
}

export async function fetchProfile(symbol) {
  try {
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('profile', symbol);
    if (cached && cached.finnhubIndustry) return cached;

    const r = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`
    );
    const d = await r.json();
    if (!d || !d.name) return {};

    const result = {
      name:            d.name || symbol,
      ticker:          symbol,
      exchange:        d.exchange || '',
      finnhubIndustry: d.finnhubIndustry || '',
      weburl:          d.weburl || '',
      country:         d.country || '',
    };
    if (result.finnhubIndustry) await setCache('profile', symbol, result, TTL.PROFILE);
    return result;
  } catch(e) { return {}; }
}

export async function sendTelegram(chatId, message) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ chat_id:chatId, text:message, parse_mode:'HTML' }),
  });
}

// ── Format a single stock result into a Telegram message block ──
function formatStockBlock(r) {
  if (r.signal === 'ERROR') return `⛔ <b>${r.ticker}</b> — ${r.error}`;

  const emoji  = { BUY:'🟢', SELL:'🔴', HOLD:'⚪', WATCH:'🟡' };
  const chgStr = (r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%';
  const reasons = r.reasons.slice(0, 2).join(' · ') || 'Neutral momentum';

  const lines = [
    `${emoji[r.signal] || '⚪'} <b>${r.ticker}</b> — ${r.signal}`,
    `Price: $${r.price.toFixed(2)} (${chgStr})`,
    `${reasons}`,
    `Support: $${r.support?.toFixed(2)} | Resist: $${r.resist?.toFixed(2)}`,
  ];

  // IV block
  if (r.iv) {
    const margin = ((r.iv.mid - r.price) / r.price * 100);
    const verdict = margin > 15  ? '🟢 UNDERVALUED'
      : margin > 5   ? '🟡 SLIGHT DISCOUNT'
      : margin < -20 ? '🔴 OVERVALUED'
      : margin < -8  ? '🟠 SLIGHT PREMIUM'
      : '⚪ FAIR VALUE';
    lines.push(`\n📊 <b>Intrinsic Value</b>`);
    lines.push(`Range: $${r.iv.lo.toFixed(0)} – $${r.iv.hi.toFixed(0)} | Mid: $${r.iv.mid.toFixed(0)}`);
    lines.push(`${verdict} (${margin >= 0 ? '+' : ''}${margin.toFixed(1)}% vs price)`);
    lines.push(`MOS Buy Zone: ≤$${r.iv.mos.toFixed(0)} (15% discount to mid)`);
  }

  // FMP rating
  if (r.fmp?.rating) {
    lines.push(`\n🏦 <b>FMP Rating</b>: ${r.fmp.rating} — ${r.fmp.recommendation || '—'}`);
  }

  return lines.join('\n');
}

// ── Run full analysis for a list of tickers ──
export async function fetchFMP(symbol) {
  try {
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('fmp', symbol);
    if (cached) return cached;

    const apiKey = process.env.FMP_API_KEY;
    const base   = 'https://financialmodelingprep.com/api/v3';
    const [dcfRes, ratingRes] = await Promise.all([
      fetch(`${base}/discounted-cash-flow/${symbol}?apikey=${apiKey}`),
      fetch(`${base}/rating/${symbol}?apikey=${apiKey}`),
    ]);
    const dcfData    = await dcfRes.json();
    const ratingData = await ratingRes.json();
    const dcf        = Array.isArray(dcfData)    ? dcfData[0]    : dcfData;
    const rating     = Array.isArray(ratingData) ? ratingData[0] : ratingData;

    const result = {
      dcf:            dcf?.dcf || null,
      recommendation: rating?.ratingRecommendation || null,
      rating:         rating?.rating || null,
    };
    if (result.dcf) await setCache('fmp', symbol, result, TTL.METRICS);
    return result;
  } catch(e) { return null; }
}

export async function runAnalysis(tickers) {
  const results = [];

  for (const ticker of tickers) {
    try {
      const [quote, candles, metrics, profile, fmp] = await Promise.all([
        fetchQuote(ticker),
        fetchCandles(ticker),
        fetchFundamentals(ticker),
        fetchProfile(ticker),
        fetchFMP(ticker),
      ]);

      if (!quote.c || !candles) { results.push({ ticker, signal:'ERROR', error:'No data' }); continue; }

      const analysis = analyzeCandles(candles, quote.c);
      const chg      = ((quote.c - quote.pc) / quote.pc * 100);
      const iv       = calcIV(metrics, profile?.finnhubIndustry || '', fmp);

      results.push({ ticker, price:quote.c, change:chg, iv, fmp, ...analysis });
    } catch(e) {
      results.push({ ticker, signal:'ERROR', error:e.message });
    }
  }

  const blocks  = results.map(formatStockBlock);
  const message = `📊 <b>APEX BRIEFING</b>\n${new Date().toDateString()}\n\n${blocks.join('\n\n─────────────\n\n')}\n\n🌐 <a href="https://apex-stocks.vercel.app">Open APEX Web App</a>`;
  return { results, message };
}
