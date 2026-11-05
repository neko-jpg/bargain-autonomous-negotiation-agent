import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const key = process.env.OPENCODE_API_KEY?.trim();
if (!key) { console.error('no key'); process.exit(0); }

const bases = [
  'https://opencode.ai/inference/v1',
  'https://opencode.ai/inference/go',
  'https://opencode.ai/inference/go/v1',
];
const models = [
  'deepseek-v4.1-flash',
  'deepseek-v4.1-flash-free',
  'glm-5.3-flash-free',
  'claude-haiku-4-5',
];

for (const base of bases) {
  for (const model of models) {
    const started = Date.now();
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8 }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let detail = text.slice(0, 160).replace(/\s+/g, ' ');
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.type ? `${parsed.error.type}: ${String(parsed.error.message).slice(0, 110)}`
          : `${parsed?.choices?.[0]?.message?.content ?? 'ok'}`;
      } catch { /* keep raw */ }
      console.log(`${String(response.status).padEnd(4)} ${String(Date.now() - started).padStart(6)}ms  ${base.replace('https://opencode.ai/inference', '')}  ${model.padEnd(26)} ${detail}`);
    } catch (error) {
      console.log(`ERR        ${base.replace('https://opencode.ai/inference', '')}  ${model.padEnd(26)} ${(error).message.slice(0, 80)}`);
    }
  }
}
