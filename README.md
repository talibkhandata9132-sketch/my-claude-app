# AI Business Builder: deploy with your own API key

1. Put this folder in a GitHub repo (or use the Vercel CLI).
2. Import it at vercel.com. No build settings needed.
3. Project Settings > Environment Variables: add ANTHROPIC_API_KEY = your key. Redeploy.
4. Open your Vercel URL. All Claude calls go through /api/claude, so the key never reaches the browser.

Before a public webinar:
- Set a monthly spend limit on your key in the Anthropic Console.
- Consider Vercel's firewall/rate limiting so one visitor cannot drain your credit.
- Optional: set CLAUDE_MODEL to use a different model.
- Website generation is a long response and needs the 300s function limit (set in vercel.json; check your Vercel plan allows it).
