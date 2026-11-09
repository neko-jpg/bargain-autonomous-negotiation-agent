/**
 * Provider probe.
 *
 * Answers one question before anything else runs: which base URL and which
 * model id actually work with the keys in `.env.local`?
 *
 * It never prints a key. It prints HTTP status, the first few model ids and,
 * with `--smoke`, a one-token chat completion.
 *
 *   npm run provider:check
 *   npm run provider:check -- --smoke
 */
import { existsSync } from 'node:fs';

const ENV_FILE = '.env.local';
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const smoke = process.argv.includes('--smoke');

const DEEPSEEK_DEFAULT_BASE = 'https://api.deepseek.com';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';

function usable(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  return normalized.length > 0 && !/^(your_|placeholder|replace_me|change_me)/i.test(normalized);
}

const preference = (process.env.BARGAIN_LLM_PROVIDER ?? 'auto').trim().toLowerCase();

// The OpenCode key is sent only to the host the user configured. Without this
// filter the OpenCode guesses below would send that key to opencode.ai, which
// is wrong for a key from another vendor. The DeepSeek key is never sent here:
// it goes only to DEEPSEEK_BASE_URL (default https://api.deepseek.com).
const configuredBase = process.env.OPENCODE_BASE_URL?.trim();
const configuredOrigin = configuredBase ? new URL(configuredBase).origin : undefined;
const OPENCODE_CANDIDATES = [
  configuredBase,
  'https://opencode.ai/inference/openai/v1',
  'https://opencode.ai/inference/go',
  'https://opencode.ai/inference/v1',
]
  .filter((value): value is string => Boolean(value))
  .filter((url) => !configuredOrigin || new URL(url).origin === configuredOrigin);

async function tryJson(url: string, headers: Record<string, string>) {
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let parsed: unknown = undefined;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, text, parsed };
  } catch (error) {
    return { status: 0, text: (error as Error).message, parsed: undefined };
  }
}

function modelIds(parsed: unknown): string[] {
  const holder = parsed as {
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  };
  const list = holder?.data ?? holder?.models ?? [];
  return list.map((item) => item.id ?? item.name ?? '').filter(Boolean);
}

/**
 * One-token chat completion against an OpenAI-compatible base URL. max_tokens is
 * generous on purpose: reasoning models spend the budget on thinking first, so a
 * small cap returns empty content and looks like a failure.
 */
async function smokeChat(base: string, key: string, model: string) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    const elapsed = Date.now() - started;
    console.log(`\n  smoke POST ${base}/chat/completions · model ${model} · ${response.status} in ${elapsed} ms`);
    console.log(`  response: ${body.slice(0, 220).replace(/\s+/g, ' ')}`);
  } catch (error) {
    console.log(`\n  smoke POST failed after ${Date.now() - started} ms: ${(error as Error).message}`);
  }
}

async function main() {
  console.log('\n--- 🔌 Provider probe ---');

  const opencodeKey = process.env.OPENCODE_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  const wants = (name: string) => preference === name || preference === 'auto';
  console.log(`BARGAIN_LLM_PROVIDER=${preference}`);

  if (wants('opencode') && usable(opencodeKey)) {
    console.log(`\nOpenCode key: set. Candidate base URLs:`);
    for (const base of OPENCODE_CANDIDATES) {
      const url = `${base.replace(/\/$/, '')}/models`;
      const result = await tryJson(url, { Authorization: `Bearer ${opencodeKey}` });
      const ids = modelIds(result.parsed).slice(0, 12);
      console.log(`  ${result.status || 'ERR'}  ${base}`);
      if (ids.length) console.log(`        models: ${ids.join(', ')}`);
      else if (result.status >= 400) console.log(`        ${result.text.slice(0, 120)}`);
    }
    console.log('\n  Set in .env.local:');
    console.log('    OPENCODE_BASE_URL=<the base URL that returned 200 above>');
    console.log('    BARGAIN_OPENCODE_MODEL=<one of the model ids above>');
    if (smoke) {
      const base = (process.env.OPENCODE_BASE_URL?.trim() || 'https://opencode.ai/inference/v1').replace(/\/$/, '');
      const model = process.env.BARGAIN_OPENCODE_MODEL?.trim() ?? '';
      if (model) await smokeChat(base, opencodeKey, model);
      else console.log('\n  smoke: set BARGAIN_OPENCODE_MODEL first');
    }
  } else if (wants('opencode')) {
    console.log('\nOpenCode: no key. Put OPENCODE_API_KEY=... in .env.local');
  }

  if (wants('deepseek') && usable(deepseekKey)) {
    const base = (process.env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_DEFAULT_BASE).replace(/\/$/, '');
    const result = await tryJson(`${base}/models`, { Authorization: `Bearer ${deepseekKey}` });
    const ids = modelIds(result.parsed).slice(0, 12);
    console.log(`\nDeepSeek: ${result.status || 'ERR'}  ${base}`);
    if (ids.length) console.log(`  models: ${ids.join(', ')}`);
    else if (result.status >= 400) console.log(`  ${result.text.slice(0, 120)}`);
    const configuredModel = process.env.BARGAIN_DEEPSEEK_MODEL?.trim();
    const model = configuredModel || DEEPSEEK_DEFAULT_MODEL;
    console.log(`  BARGAIN_DEEPSEEK_MODEL=${model}${configuredModel ? '' : ' (default)'}`);
    if (smoke) await smokeChat(base, deepseekKey, model);
  } else if (wants('deepseek')) {
    console.log('\nDeepSeek: no key. Put DEEPSEEK_API_KEY=... in .env.local');
  }

  if (wants('openai') && usable(openaiKey)) {
    const result = await tryJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${openaiKey}` });
    const ids = modelIds(result.parsed).slice(0, 8);
    console.log(`\nOpenAI: ${result.status || 'ERR'}`);
    if (ids.length) console.log(`  models: ${ids.join(', ')}`);
  } else if (wants('openai')) {
    console.log('\nOpenAI: no key.');
  }

  if (wants('google') && usable(googleKey)) {
    const result = await tryJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(googleKey)}`, {});
    const ids = modelIds(result.parsed).slice(0, 8);
    console.log(`\nGoogle: ${result.status || 'ERR'}`);
    if (ids.length) console.log(`  models: ${ids.join(', ')}`);
  } else if (wants('google')) {
    console.log('\nGoogle: no key.');
  }

  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
