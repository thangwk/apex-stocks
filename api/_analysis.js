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
export function calcIV(m, industry, fmp, targets) {
  const sectorPE   = getSectorMultiple(industry, SECTOR_PE, 18);
  const sectorPFCF = getSectorMultiple(industry, SECTOR_PFCF, 18);
  const sectorEV   = getSectorMultiple(industry, SECTOR_EV, 14);

  const epsGAAP  = m.epsBasicExclExtraAnnual || m.epsTTM || 0;
  const epsTTM   = m.epsTTM || epsGAAP;
  // FIX 2: use forward EPS if available, else fall back to TTM
  const epsForwd = m.epsForward || m.epsEstimateNext || epsTTM;
  const bvps     = m.bookValuePerShareAnnual || 0;
  const roe      = m.roeRfy || m.roeTTM || 0;
  const fcfPS    = m.cashFlowPerShareTTM || m.freeCashFlowPerShareTTM || 0;
  const ebitdaPS = m.ebitdPerShareTTM || m.ebitdPerShareAnnual || m.ebitdaPerShare || 0;
  const evEbitda = m.evEbitdaTTM || 0;
  const revenuePS= m.revenuePerShareTTM || m.revenuePerShareAnnual || 0;
  const psRatio  = m.psTTM || 0;
  const fwdPE    = m.forwardPE || 0;
  const beta     = m.beta || 1;

  // Best growth
  const growth = Math.min(Math.max(
    m.revenueGrowth3Y || 0, m.epsGrowth3Y || 0,
    ((m.epsGrowthTTMYoy || 0) + (m.revenueGrowthTTMYoy || 0)) / 2, 3
  ), 50);
  const highGrowth = growth > 15;
  const earningsPS = fcfPS > 0 ? fcfPS : epsGAAP;

  const methods = [];

  // FIX 3: Raise DCF growth cap — 25% for high growth, fade to terminal 3%
  if (fcfPS > 0) {
    const r  = 0.09;
    const g1 = Math.min(growth / 100, highGrowth ? 0.25 : 0.10); // stage 1 (yrs 1-5)
    const g2 = Math.min(g1 * 0.5, 0.05);                          // stage 2 (yrs 6-10), fade
    const gt = 0.03;                                                // terminal
    // Two-stage DCF
    let v = 0;
    let cf = fcfPS;
    for (let yr = 1; yr <= 5;  yr++) { cf *= (1 + g1); v += cf / Math.pow(1+r, yr); }
    for (let yr = 6; yr <= 10; yr++) { cf *= (1 + g2); v += cf / Math.pow(1+r, yr); }
    const terminal = (cf * (1 + gt)) / (r - gt);
    v += terminal / Math.pow(1+r, 10);
    if (v > 0 && isFinite(v)) methods.push({ name:'DCF/FCF (2-stage)', value:v, weight:2.5 });
  } else if (epsGAAP > 0) {
    const r  = 0.09;
    const g1 = Math.min(growth / 100, highGrowth ? 0.20 : 0.08);
    const g2 = Math.min(g1 * 0.5, 0.04);
    const gt = 0.03;
    let v = 0, cf = epsGAAP * 0.75;
    for (let yr = 1; yr <= 5;  yr++) { cf *= (1 + g1); v += cf / Math.pow(1+r, yr); }
    for (let yr = 6; yr <= 10; yr++) { cf *= (1 + g2); v += cf / Math.pow(1+r, yr); }
    v += (cf * (1 + gt)) / (r - gt) / Math.pow(1+r, 10);
    if (v > 0 && isFinite(v)) methods.push({ name:'DCF/EPS (2-stage)', value:v, weight:1.5 });
  }

  // FIX 2: Forward P/E — use forward EPS, no arbitrary haircut
  if (fwdPE > 0 && epsForwd > 0) {
    // Fair P/E = sector P/E, capped at 1.1× current forward P/E (don't assume re-rating)
    const fairFwdPE = Math.min(sectorPE, fwdPE * 1.1);
    const v = epsForwd * fairFwdPE;
    if (v > 0) methods.push({ name:'Forward P/E', value:v, weight:2 });
  }

  // FIX 4: P/FCF — use blended market + sector multiple, not sector alone
  if (fcfPS > 0) {
    const marketPFCF  = m.pfcfShareTTM || 0;
    const blendedPFCF = marketPFCF > 0
      ? (sectorPFCF * 0.6 + marketPFCF * 0.4)  // blend sector norm with market reality
      : sectorPFCF;
    methods.push({ name:'P/FCF', value:fcfPS * Math.min(blendedPFCF, sectorPFCF * 1.3), weight:2 });
  }

  // FIX 4: EV/EBITDA — blend sector avg with actual market multiple
  if (ebitdaPS > 0) {
    const blendedEV = evEbitda > 0
      ? (sectorEV * 0.6 + evEbitda * 0.4)
      : sectorEV;
    methods.push({ name:'EV/EBITDA', value:ebitdaPS * Math.min(blendedEV, sectorEV * 1.3), weight:2 });
  }

  // Sector P/E
  if (earningsPS > 0)
    methods.push({ name:'Sector P/E', value:earningsPS * sectorPE, weight:1.5 });

  // PEG
  if (earningsPS > 0 && growth > 5) {
    const fairPE = Math.min(growth * 1.5, 60);
    methods.push({ name:'PEG', value:earningsPS * fairPE, weight:1 });
  }

  // P/S for tech
  if (revenuePS > 0 && (highGrowth || ['Technology','Software','Internet','Semiconductor'].some(s => industry.includes(s)))) {
    const fairPS = Math.min(psRatio > 0 ? psRatio * 0.8 : sectorEV * 0.4, 20);
    if (fairPS > 0) methods.push({ name:'P/S', value:revenuePS * fairPS, weight:1 });
  }

  // Graham (value only)
  if (epsGAAP > 0 && bvps > 5 && !highGrowth && roe < 50)
    methods.push({ name:'Graham', value:Math.sqrt(22.5 * epsGAAP * bvps), weight:0.5 });

  // P/B
  if (bvps > 0 && roe > 0) {
    const cappedROE = Math.min(roe, 50);
    const fairPB = Math.min((cappedROE/100)/0.09, 8);
    methods.push({ name:'P/B', value:bvps * fairPB, weight:0.5 });
  }

  // DDM
  const divTTM  = m.dividendPerShareTTM || 0;
  const divGrow = (m.dividendGrowthRate5Y || 0) / 100;
  if (divTTM > 0 && divGrow > 0 && divGrow < 0.09) {
    const v = (divTTM * (1 + divGrow)) / (0.09 - divGrow);
    if (v > 0) methods.push({ name:'DDM', value:v, weight:1.5 });
  }

  // FIX 1: Analyst target excluded from IV model — used separately in recommendation only

  if (methods.length === 0) return null;

  // Drop outliers beyond 3× median (tighter than before)
  const vals   = methods.map(x => x.value).sort((a,b) => a-b);
  const median = vals[Math.floor(vals.length / 2)];
  const pool   = methods.filter(x => x.value > 0 && x.value < median * 3 && x.value > median / 3);
  const final  = pool.length > 0 ? pool : methods;

  const totalW = final.reduce((s,x) => s+x.weight, 0);
  const mid    = final.reduce((s,x) => s+x.value*x.weight, 0) / totalW;

  // FIX 5: std deviation band instead of min/max
  const variance = final.reduce((s,x) => s + x.weight * Math.pow(x.value - mid, 2), 0) / totalW;
  const stdDev   = Math.sqrt(variance);
  const lo       = Math.max(mid - stdDev, Math.min(...final.map(x=>x.value)));
  const hi       = Math.min(mid + stdDev, Math.max(...final.map(x=>x.value)));

  // FIX 6: MOS scales with beta — higher beta = larger required margin of safety
  const mosPct = Math.min(0.10 + (beta - 1) * 0.05, 0.25); // 10% base + 5% per beta point, max 25%
  const mos    = mid * (1 - mosPct);

  return { mid, lo, hi, mos, mosPct, stdDev, methodCount: final.length };
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
  try {
    const { getCache, setCache } = await import('./_redis.js');
    const TTL_CANDLES = 6 * 60 * 60 * 1000; // 6 hours
    const cached = await getCache('candles', symbol);
    if (cached) return { data: cached, fromCache: true };

    const r = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=60&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const data = await r.json();
    if (!data.values) return { data: null, fromCache: false };
    const candles = data.values.reverse().map(v => ({
      date:v.datetime, open:parseFloat(v.open), high:parseFloat(v.high),
      low:parseFloat(v.low), close:parseFloat(v.close), volume:parseInt(v.volume)||0,
    }));
    await setCache('candles', symbol, candles, TTL_CANDLES);
    return { data: candles, fromCache: false };
  } catch(e) { return { data: null, fromCache: false }; }
}

export async function fetchQuote(symbol) {
  try {
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('quote', symbol);
    if (cached) return { data: cached, fromCache: true };

    const r = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const d = await r.json();
    if (d.status === 'error') throw new Error(d.message);
    const result = { c:parseFloat(d.close), pc:parseFloat(d.previous_close), o:parseFloat(d.open), h:parseFloat(d.high), l:parseFloat(d.low) };
    await setCache('quote', symbol, result, TTL.QUOTE);
    return { data: result, fromCache: false };
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
export function formatStockBlock(r) {
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

  // IV + recommendation block
  if (r.iv) {
    const price    = r.price;
    const { mid, lo, hi, mos } = r.iv;
    const margin   = ((mid - price) / price * 100);
    const analystT = r.targets?.targetMean || mid;
    const upside   = ((analystT - price) / price * 100);
    const buyBelow = (mid * 0.88).toFixed(2);
    const stopLoss = (price * 0.93).toFixed(2);

    const verdict = margin > 10  ? '🟢 UNDERVALUED'
      : margin > 3   ? '🟡 SLIGHT DISCOUNT'
      : margin < -15 ? '🔴 OVERVALUED'
      : margin < -5  ? '🟠 SLIGHT PREMIUM'
      : '⚪ FAIR VALUE';

    let action, levels;
    if (margin > 10) {
      action = '▲ BUY';
      levels = `▶ Enter now ~$${price.toFixed(2)} or scale below $${(mid*0.95).toFixed(2)}\n▶ Add on dips to $${buyBelow}\n▶ Stop loss: $${stopLoss}\n▶ Target: $${analystT.toFixed(2)} (+${upside.toFixed(1)}%)`;
    } else if (margin > 3) {
      action = '◆ WATCH';
      levels = `▶ Buy on dip below $${(mid*0.95).toFixed(2)}\n▶ Ideal entry: $${buyBelow}\n▶ Stop loss: $${stopLoss}\n▶ Target: $${analystT.toFixed(2)} (+${upside.toFixed(1)}%)`;
    } else if (margin < -15) {
      action = '▼ AVOID';
      levels = `▶ Do not buy at $${price.toFixed(2)}\n▶ Watch for entry at $${buyBelow}\n▶ Fair value zone: $${lo.toFixed(0)}–$${hi.toFixed(0)}`;
    } else if (margin < -5) {
      action = '⚠ CAUTION';
      levels = `▶ Avoid adding at current price\n▶ Buy if falls to $${(mid*0.93).toFixed(2)}\n▶ Stop if holding: $${(price*0.96).toFixed(2)}`;
    } else {
      action = '— HOLD';
      levels = `▶ Hold — fair value $${lo.toFixed(0)}–$${hi.toFixed(0)}\n▶ Add on dip to $${buyBelow}\n▶ Target: $${analystT.toFixed(2)} · Stop: $${stopLoss}`;
    }

    lines.push(`\n📊 <b>Valuation · ${action}</b>`);
    lines.push(`IV Range: $${lo.toFixed(0)} – $${hi.toFixed(0)} | Mid: $${mid.toFixed(0)}`);
    lines.push(`${verdict} (${margin >= 0 ? '+' : ''}${margin.toFixed(1)}% vs price)`);
    lines.push(levels);
  }

  // FMP rating
  if (r.fmp?.rating) {
    lines.push(`\n🏦 <b>FMP Rating</b>: ${r.fmp.rating} — ${r.fmp.recommendation || '—'}`);
  }

  // Analyst target
  if (r.targets?.targetMean) {
    const total    = (r.targets.strongBuy||0)+(r.targets.buy||0)+(r.targets.hold||0)+(r.targets.sell||0)+(r.targets.strongSell||0);
    const bullish  = (r.targets.strongBuy||0)+(r.targets.buy||0);
    const sentiment = total > 0 ? (bullish/total >= 0.6 ? '▲ Bullish' : bullish/total <= 0.35 ? '▼ Bearish' : '◆ Mixed') : '';
    lines.push(`\n🎯 <b>Analyst Target</b>: $${r.targets.targetMean.toFixed(2)} ${sentiment}`);
    lines.push(`Range: $${(r.targets.targetLow||0).toFixed(0)} – $${(r.targets.targetHigh||0).toFixed(0)} · ${r.targets.analysts||'?'} analysts`);
  }

  return lines.join('\n');
}

// ── Run full analysis for a list of tickers ──
export async function fetchTargets(symbol) {
  try {
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('targets', symbol);
    if (cached) return cached;

    const token = process.env.FINNHUB_API_KEY;
    const [targetRes, recRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${symbol}&token=${token}`),
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${token}`),
    ]);
    const targetData = await targetRes.json();
    const recData    = await recRes.json();
    const rec = Array.isArray(recData) ? recData[0] : null;

    const result = {
      targetMean:   targetData.targetMean   || null,
      targetHigh:   targetData.targetHigh   || null,
      targetLow:    targetData.targetLow    || null,
      analysts:     targetData.numberOfAnalysts || null,
      strongBuy:    rec?.strongBuy  || 0,
      buy:          rec?.buy        || 0,
      hold:         rec?.hold       || 0,
      sell:         rec?.sell       || 0,
      strongSell:   rec?.strongSell || 0,
    };
    if (result.targetMean) await setCache('targets', symbol, result, TTL.METRICS);
    return result;
  } catch(e) { return null; }
}

export async function fetchFMP(symbol) {
  try {
    const { getCache, setCache, TTL } = await import('./_redis.js');
    const cached = await getCache('fmp', symbol);
    if (cached && cached.rating) return cached;

    const apiKey = process.env.FMP_API_KEY;
    const r = await fetch(
      `https://financialmodelingprep.com/stable/ratings-snapshot?symbol=${symbol}&apikey=${apiKey}`
    );
    const data = await r.json();
    const d = Array.isArray(data) ? data[0] : null;
    if (!d) return null;

    const result = {
      rating:         d.rating || null,
      overallScore:   d.overallScore || null,
      dcfScore:       d.discountedCashFlowScore || null,
      recommendation: d.overallScore >= 5 ? 'Strong Buy'
                    : d.overallScore >= 4 ? 'Buy'
                    : d.overallScore >= 3 ? 'Neutral'
                    : d.overallScore >= 2 ? 'Underperform' : 'Sell',
    };
    await setCache('fmp', symbol, result, TTL.METRICS);
    return result;
  } catch(e) { return null; }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// Twelve Data free tier = 8 calls/minute
// fetchQuote = 1 call, fetchCandles = 1 call → 2 per stock
// Process one stock at a time serially, 8s gap between stocks = max 7.5 stocks/min safely
// ── Rate limiting: only delay when live Twelve Data API calls are made ──

export async function runAnalysis(tickers, onResult) {
  const results = [];
  let apiCallsSinceLastDelay = 0;
  let lastApiCallTime = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];

    try {
      // Twelve Data calls — track if they hit the live API
      const { data: quote, fromCache: quoteFromCache }     = await fetchQuote(ticker);
      const { data: candles, fromCache: candlesFromCache } = await fetchCandles(ticker);

      const usedApi = !quoteFromCache || !candlesFromCache;

      // If we hit the live API, track rate limiting
      if (usedApi) {
        const now = Date.now();
        apiCallsSinceLastDelay += (!quoteFromCache ? 1 : 0) + (!candlesFromCache ? 1 : 0);

        // If we've made 6+ calls since last delay, enforce 60s window
        if (apiCallsSinceLastDelay >= 6) {
          const elapsed = now - lastApiCallTime;
          const wait = Math.max(0, 60000 - elapsed);
          if (wait > 0) {
            console.log(`Rate limit pause: ${wait}ms (${apiCallsSinceLastDelay} calls made)`);
            await delay(wait);
          }
          apiCallsSinceLastDelay = 0;
          lastApiCallTime = Date.now();
        } else if (lastApiCallTime === 0) {
          lastApiCallTime = now;
        }
      }

      // Non-rate-limited calls — fire in parallel
      const [metrics, profile, fmp, targets] = await Promise.all([
        fetchFundamentals(ticker),
        fetchProfile(ticker),
        fetchFMP(ticker),
        fetchTargets(ticker),
      ]);

      let result;
      if (!quote?.c || !candles) {
        result = { ticker, signal:'ERROR', error:'No price data' };
      } else {
        const analysis = analyzeCandles(candles, quote.c);
        const chg      = ((quote.c - quote.pc) / quote.pc * 100);
        const iv       = calcIV(metrics, profile?.finnhubIndustry || '', fmp, targets);
        result = { ticker, price:quote.c, change:chg, iv, fmp, targets, ...analysis };
      }

      results.push(result);
      if (onResult) await onResult(result);

    } catch(e) {
      const result = { ticker, signal:'ERROR', error:e.message };
      results.push(result);
      if (onResult) await onResult(result);
    }
  }

  const footer = `✅ <b>Done</b> — ${results.length} stock${results.length > 1 ? 's' : ''} analysed\n🌐 <a href="https://apex-stocks.vercel.app">Open APEX Terminal</a>`;
  return { results, footer };
}
