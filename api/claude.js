// Serverless proxy: keeps ANTHROPIC_API_KEY on the server, never in the browser.
export const config = { maxDuration: 300 };

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const HARD_CAP = 16000;          // max output tokens we ever request
const RETRY_DEADLINE_MS = 120000; // don't start a retry if the first attempt already took this long

// Extract and fully parse a JSON object from model text. Returns the parsed object or null.
// Never returns partial data: JSON.parse must succeed on the whole extracted span.
function parseJsonObject(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function callAnthropic({ key, model, max_tokens, prompt, json }) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens,
      system: json
        ? 'Respond with a single complete, valid JSON object only. No markdown fences, no commentary. Keep every string value concise so the whole object fits comfortably within the output limit.'
        : undefined,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON upstream body */ }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only', code: 'METHOD_NOT_ALLOWED' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.', code: 'SERVER_CONFIG' });

  const { prompt, tier, json } = req.body || {};
  if (typeof prompt !== 'string' || !prompt || prompt.length > 80000)
    return res.status(400).json({ error: 'Invalid prompt.', code: 'BAD_REQUEST' });

  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  // Unchanged: complex = 16000. Plain-text default stays 4000. JSON default raised 4000 -> 8000
  // because the larger stage blueprints (e.g. Customer) were being cut off mid-object.
  const baseTokens = tier === 'complex' ? HARD_CAP : json ? 8000 : 4000;

  const started = Date.now();
  let budget = baseTokens;
  let last = { code: 'UPSTREAM_ERROR', error: 'Unknown error.' };

  for (let attempt = 1; attempt <= (json ? 2 : 1); attempt++) {
    let out;
    try {
      out = await callAnthropic({ key, model, max_tokens: budget, prompt, json });
    } catch {
      return res.status(502).json({ error: 'Could not reach the Anthropic API.', code: 'UPSTREAM_UNREACHABLE', retryable: true });
    }

    if (!out.ok) {
      const msg = out.data?.error?.message || `Anthropic API error (${out.status})`;
      const retryable = out.status === 429 || out.status >= 500;
      return res.status(502).json({ error: msg, code: 'UPSTREAM_ERROR', retryable });
    }

    const text = (out.data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const stop = out.data?.stop_reason;

    // Plain-text mode: unchanged behaviour.
    if (!json) return res.status(200).json({ text });

    // JSON mode: only return text that is complete AND fully parses.
    if (stop === 'max_tokens') {
      last = { code: 'INCOMPLETE_JSON', error: 'The AI response was cut off before it finished. Please try again.', stop_reason: stop };
      budget = Math.min(budget * 2, HARD_CAP); // give the retry more room
    } else {
      const parsed = parseJsonObject(text);
      if (parsed) return res.status(200).json({ text: JSON.stringify(parsed) });
      last = { code: 'INVALID_JSON', error: 'The AI returned an invalid response. Please try again.', stop_reason: stop || null };
    }

    if (Date.now() - started > RETRY_DEADLINE_MS) break; // avoid running into the function timeout
  }

  return res.status(502).json({ error: last.error, code: last.code, stop_reason: last.stop_reason ?? null, retryable: true });
}
