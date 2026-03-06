export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate request body
  const messages   = req.body?.messages;
  const maxTokens  = Math.min(parseInt(req.body?.maxTokens) || 800, 1024);
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  // Basic sanitisation — ensure each message has role + string content
  const clean = messages.filter(m =>
    m && typeof m.role === 'string' && typeof m.content === 'string'
  );
  if (clean.length === 0) return res.status(400).json({ error: 'No valid messages' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:      'llama-3.3-70b-versatile',
        max_tokens: maxTokens,  // respect caller's token budget
        messages:   clean,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Groq API error' });
    res.status(200).json({ text: data.choices?.[0]?.message?.content || 'No response.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
