// Serverless proxy: keeps ANTHROPIC_API_KEY on the server, never in the browser.
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });

  const { prompt, tier, json } = req.body || {};
  if (typeof prompt !== 'string' || !prompt || prompt.length > 80000)
    return res.status(400).json({ error: 'Invalid prompt.' });

  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  const max_tokens = tier === 'complex' ? 16000 : 4000;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens,
        system: json ? 'Respond with a single valid JSON object only. No markdown fences, no commentary.' : undefined,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'Anthropic API error' });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the Anthropic API.' });
  }
}
