// Simple Redis client using native fetch + Redis REST-like commands via ioredis
// We use the `redis` npm package via dynamic import for Vercel serverless

import { createClient } from 'redis';

let client = null;

async function getClient() {
  if (client) return client;
  client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e));
  await client.connect();
  return client;
}

const WATCHLIST_KEY = 'apex:watchlist';

export async function getWatchlist() {
  const redis = await getClient();
  const data  = await redis.get(WATCHLIST_KEY);
  return data ? JSON.parse(data) : [];
}

export async function saveWatchlist(tickers) {
  const redis = await getClient();
  await redis.set(WATCHLIST_KEY, JSON.stringify(tickers));
}

export async function addTicker(ticker) {
  const list = await getWatchlist();
  if (!list.includes(ticker)) {
    list.push(ticker);
    await saveWatchlist(list);
  }
  return list;
}

export async function removeTicker(ticker) {
  const list = await getWatchlist();
  const updated = list.filter(t => t !== ticker);
  await saveWatchlist(updated);
  return updated;
}
