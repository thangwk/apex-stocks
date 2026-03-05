import { createClient } from 'redis';

let client = null;

async function getClient() {
  if (client) return client;
  client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e));
  await client.connect();
  return client;
}

// ── Per-user watchlist keys ──────────────────────────────────────
// apex:watchlist:<chatId>  →  ["AAPL","TSLA"]
// apex:users               →  ["111","222","333"]  (all known chat IDs)

function userKey(chatId) {
  return `apex:watchlist:${chatId}`;
}

// Get all registered user chat IDs
export async function getAllUsers() {
  const redis = await getClient();
  const data  = await redis.get('apex:users');
  return data ? JSON.parse(data) : [];
}

async function registerUser(chatId) {
  const redis = await getClient();
  const users = await getAllUsers();
  if (!users.includes(chatId)) {
    users.push(chatId);
    await redis.set('apex:users', JSON.stringify(users));
  }
}

// ── Per-user CRUD ────────────────────────────────────────────────
export async function getWatchlist(chatId) {
  const redis = await getClient();
  const data  = await redis.get(userKey(chatId));
  return data ? JSON.parse(data) : [];
}

export async function saveWatchlist(chatId, tickers) {
  const redis = await getClient();
  await redis.set(userKey(chatId), JSON.stringify(tickers));
  await registerUser(chatId); // ensure user is tracked for cron
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
