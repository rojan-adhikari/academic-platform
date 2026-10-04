// nerd AI endpoints: mode, the person's own facts, and online chat (Claude, an OpenAI-compatible endpoint, or local Ollama).
const assistant = require('../assistant');
const { HttpError } = require('../lib');

const WINDOW_MS = 10 * 60 * 1000, LIMIT = 40;
const usage = new Map(); // userId -> recent request times
function rateLimit(userId) {
  const now = Date.now();
  const list = (usage.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= LIMIT) throw new HttpError(429, 'You are sending messages very quickly. Please wait a few minutes.');
  list.push(now); usage.set(userId, list);
}

module.exports = (api) => {
  api.get('/api/assistant/status', async (ctx) => {
    if (!ctx.user) return { mode: 'offline', provider: null };
    const p = await assistant.provider();
    return { mode: p ? 'online' : 'offline', provider: p ? p.name : null };
  }, { public: true });

  api.get('/api/assistant/facts', (ctx) => ({ facts: assistant.factsFor(ctx.user) }));

  api.post('/api/assistant/chat', async (ctx) => {
    const p = await assistant.provider();
    if (!p) throw new HttpError(503, 'The online assistant is not configured.');
    rateLimit(ctx.user.id);
    try {
      const out = await assistant.chat(ctx.user, ctx.body.messages, ctx.body.page);
      if (!out || !out.reply) throw new HttpError(502, 'The assistant did not reply.');
      return out;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const Anthropic = p.name === 'claude' ? assistant.getAnthropic() : null;
      if (Anthropic && e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'The assistant is busy right now.');
      if (Anthropic && e instanceof Anthropic.AuthenticationError) { console.error('[nerd AI] Invalid ANTHROPIC_API_KEY.'); throw new HttpError(503, 'The online assistant is not available.'); }
      if (Anthropic && e instanceof Anthropic.APIError) { console.error(`[nerd AI] API error ${e.status}: ${e.message}`); throw new HttpError(503, 'The online assistant is not available.'); }
      assistant.forget();
      console.error(`[nerd AI] ${p.name} chat failed:`, e && e.message);
      throw new HttpError(503, 'The online assistant is not available.');
    }
  }, { limit: 64 * 1024 });
};
