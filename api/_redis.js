import { createClient } from 'redis';

let client = null;

async function getClient() {
  if (client) return client;
  client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e));
  await client.connect();
  return client;
}

// ── Per-user keys ────────────────────────────────────────────────
// apex:watchlist:<chatId>  →  ["AAPL","TSLA"]
// apex:users               →  ["111","222"]   (all chat IDs)
// apex:user:<chatId>       →  { chatId, username, firstName, lastSeen }

function userKey(chatId)    { return `apex:watchlist:${chatId}`; }
function profileKey(chatId) { return `apex:user:${chatId}`; }

export async function getAllUsers() {
  const redis = await getClient();
  const data  = await redis.get('apex:users');
  return data ? JSON.parse(data) : [];
}

export async function getUserProfile(chatId) {
  const redis = await getClient();
  const data  = await redis.get(profileKey(chatId));
  return data ? JSON.parse(data) : null;
}

export async function registerUser(chatId, msgFrom) {
  const redis = await getClient();

  // Track chat ID in users list
  const users = await getAllUsers();
  if (!users.includes(chatId)) {
    users.push(chatId);
    await redis.set('apex:users', JSON.stringify(users));
  }

  // Store/update user profile
  const profile = {
    chatId,
    username:  msgFrom?.username  || null,
    firstName: msgFrom?.first_name || null,
    lastName:  msgFrom?.last_name  || null,
    lastSeen:  new Date().toISOString(),
  };
  await redis.set(profileKey(chatId), JSON.stringify(profile));
}

// ── Per-user watchlist CRUD ──────────────────────────────────────
export async function getWatchlist(chatId) {
  const redis = await getClient();
  const data  = await redis.get(userKey(chatId));
  return data ? JSON.parse(data) : [];
}

export async function saveWatchlist(chatId, tickers) {
  const redis = await getClient();
  await redis.set(userKey(chatId), JSON.stringify(tickers));
}

export async function addTicker(chatId, ticker) {
  const list = await getWatchlist(chatId);
  if (!list.includes(ticker)) {
    list.push(ticker);
    await saveWatchlist(chatId, list);
  }
  return list;
}

export async function removeTicker(chatId, ticker) {
  const list = await getWatchlist(chatId);
  const updated = list.filter(t => t !== ticker);
  await saveWatchlist(chatId, updated);
  return updated;
}

export async function clearWatchlist(chatId) {
  await saveWatchlist(chatId, []);
}

// ── Cache helpers ────────────────────────────────────────────────
// apex:cache:<type>:<SYMBOL>  →  { data, cachedAt }

function cacheKey(type, symbol) {
  return `apex:cache:${type}:${symbol.toUpperCase()}`;
}

export async function getCache(type, symbol) {
  try {
    const redis = await getClient();
    const raw   = await redis.get(cacheKey(type, symbol));
    if (!raw) return null;
    const { data, cachedAt, ttl } = JSON.parse(raw);
    // Check if expired
    if (Date.now() - cachedAt > ttl) {
      await redis.del(cacheKey(type, symbol));
      return null;
    }
    return data;
  } catch(e) { return null; }
}

export async function setCache(type, symbol, data, ttlMs) {
  try {
    const redis = await getClient();
    await redis.set(
      cacheKey(type, symbol),
      JSON.stringify({ data, cachedAt: Date.now(), ttl: ttlMs }),
      { EX: Math.ceil(ttlMs / 1000) } // Redis native TTL as backup
    );
  } catch(e) { /* cache write failure is non-fatal */ }
}

// TTL constants
export const TTL = {
  QUOTE:   15  * 60 * 1000,  // 15 minutes
  METRICS: 24  * 60 * 60 * 1000,  // 24 hours
  PROFILE: 7   * 24 * 60 * 60 * 1000,  // 7 days
};
