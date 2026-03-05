// Temporary debug endpoint — clears stuck briefing lock
import { getClient } from './_redis.js';

export default async function handler(req, res) {
  try {
    const redis = await getClient();
    const keys = await redis.keys('apex:lock:briefing:*');
    if (keys.length) {
      await Promise.all(keys.map(k => redis.del(k)));
      return res.status(200).json({ cleared: keys });
    }
    res.status(200).json({ cleared: [], message: 'No locks found' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
