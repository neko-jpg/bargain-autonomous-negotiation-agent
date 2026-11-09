import { Checker } from '../support/check';
import { LLMProviderService } from '../../src/lib/agent/llmProvider';

/** Every variable the provider selection reads. Each case starts from an empty slate. */
const PROVIDER_ENV = [
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'OPENCODE_API_KEY',
  'OPENCODE_BASE_URL',
  'BARGAIN_OPENCODE_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'BARGAIN_DEEPSEEK_MODEL',
  'BARGAIN_LLM_PROVIDER',
  'BARGAIN_LLM_REASONING_EFFORT',
] as const;

type ProviderEnvName = (typeof PROVIDER_ENV)[number];

interface Selected {
  provider: string;
  modelName: string;
  baseURL?: string;
}

/** Runs the private provider selection under the given environment, then restores the real one. */
function selectWith(env: Partial<Record<ProviderEnvName, string>>): Selected | null {
  const saved = new Map<string, string | undefined>(PROVIDER_ENV.map((name) => [name, process.env[name]]));
  try {
    for (const name of PROVIDER_ENV) delete process.env[name];
    for (const name of PROVIDER_ENV) {
      const value = env[name];
      if (value !== undefined) process.env[name] = value;
    }
    const selected = (LLMProviderService as unknown as {
      getModel(): { model: { clientConfig?: { baseURL?: string } }; provider: string; modelName: string } | null;
    }).getModel();
    if (!selected) return null;
    return {
      provider: selected.provider,
      modelName: selected.modelName,
      baseURL: selected.model.clientConfig?.baseURL,
    };
  } finally {
    for (const name of PROVIDER_ENV) {
      const original = saved.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }
}

export function runLlmProviderTests(): boolean {
  console.log('\n--- LLM provider selection ---');
  const check = new Checker('llm-provider');

  const deepseek = selectWith({ BARGAIN_LLM_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-deepseek' });
  check.record('P1', 'deepseek preference with a key selects DeepSeek with the documented defaults',
    deepseek?.provider === 'deepseek' && deepseek.modelName === 'deepseek-flash' && deepseek.baseURL === 'https://api.deepseek.com',
    JSON.stringify(deepseek));

  const overridden = selectWith({
    BARGAIN_LLM_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: 'sk-test-deepseek',
    BARGAIN_DEEPSEEK_MODEL: 'deepseek-x',
    DEEPSEEK_BASE_URL: 'https://proxy.example.test/v1/',
  });
  check.record('P2', 'model and base URL can be overridden, and a trailing slash is dropped',
    overridden?.modelName === 'deepseek-x' && overridden.baseURL === 'https://proxy.example.test/v1',
    JSON.stringify(overridden));

  const onlyDeepseek = selectWith({ DEEPSEEK_API_KEY: 'sk-test-deepseek' });
  check.record('P3', 'auto selects DeepSeek when it is the only usable key',
    onlyDeepseek?.provider === 'deepseek', JSON.stringify(onlyDeepseek));

  const ordered = selectWith({
    DEEPSEEK_API_KEY: 'sk-test-deepseek',
    OPENCODE_API_KEY: 'sk-test-opencode',
    BARGAIN_OPENCODE_MODEL: 'test-model',
  });
  check.record('P4', 'auto tries OpenCode before DeepSeek', ordered?.provider === 'opencode', JSON.stringify(ordered));

  const placeholder = selectWith({ BARGAIN_LLM_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'your_deepseek_api_key_here' });
  check.record('P5', 'a placeholder DeepSeek key is never used', placeholder === null, JSON.stringify(placeholder));

  const none = selectWith({ BARGAIN_LLM_PROVIDER: 'auto' });
  check.record('P6', 'with no usable key there is no model, so the heuristic engine runs', none === null, JSON.stringify(none));

  return check.passed;
}
