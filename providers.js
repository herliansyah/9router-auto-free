/**
 * Provider registry - the single source of truth for every free-model source.
 *
 * Adding a provider = adding ONE record here (plus, only when its discovery is
 * genuinely bespoke, one implementation in the DISCOVERY dispatch in sync.js).
 * Everything else is derived from these records: managed combos, combo-prefix
 * map, usage-feedback provider map, benchmark-match prefix stripping, the
 * main() fan-out, per-provider injection wiring, and exclusion checks.
 *
 * Record fields:
 *   key         internal handle (candidates-state.json, injection defs)
 *   label       human-readable name for logs
 *   combo       dedicated per-provider combo name
 *   prefixes    every model-id first segment AND exclusion alias spelling
 *   kind        discovery implementation (dispatch table in sync.js)
 *   usageName   provider name used in 9router usageHistory rows (ranking penalty)
 *   connection  providerConnections.row name in the 9router DB (optional)
 *   baseUrl     default API base URL
 *   credentialKind how to shape credentials from the DB row
 *                  default | scan | kilo | bai | cloudflare
 *   readBaseUrlFromConnection honour a user-overridden baseUrl on the row
 *   skipPatterns   id substrings to drop before the live pre-test
 *   requireApiKey  false -> fetch without auth header when no key is stored
 *   solo           true -> pre-test serially (concurrency 1)
 *   throttleMs     delay before each pre-test request (rate-limited providers)
 */
const PROVIDERS = [
  {
    key: 'oa', label: 'OpenAgentic', combo: 'openagentic-free',
    prefixes: ['openagentic', 'oa'], usageName: 'openagentic',
    kind: 'openagentic', credentialKind: 'scan',
    baseUrl: 'https://openagentic.id/api/v1'
  },
  {
    key: 'kilo', label: 'Kilo.ai', combo: 'kilo-free',
    prefixes: ['kc', 'kilocode'], usageName: 'kilocode',
    kind: 'kilo', connection: 'kilocode', credentialKind: 'kilo',
    baseUrl: 'https://api.kilo.ai/api/gateway'
  },
  {
    key: 'oc', label: 'OpenCode', combo: 'opencode-free',
    prefixes: ['oc', 'opencode'], usageName: 'opencode',
    kind: 'opencode'
  },
  {
    key: 'openrouter', label: 'OpenRouter', combo: 'openrouter-free',
    prefixes: ['openrouter'], usageName: 'openrouter',
    kind: 'openrouter', connection: 'openrouter', credentialKind: 'default',
    baseUrl: 'https://openrouter.ai/api/v1', requireApiKey: false
  },
  {
    key: 'poolside', label: 'Poolside', combo: 'poolside-free',
    prefixes: ['poolside'], usageName: 'poolside',
    kind: 'poolside', connection: 'poolside', credentialKind: 'default',
    baseUrl: 'https://inference.poolside.ai/v1', readBaseUrlFromConnection: true
  },
  {
    key: 'gemini', label: 'Gemini', combo: 'gemini-free',
    prefixes: ['gemini'], usageName: 'gemini',
    kind: 'gemini', connection: 'gemini', credentialKind: 'default',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
  },
  {
    key: 'ollama', label: 'Ollama Cloud', combo: 'ollama-free',
    prefixes: ['ollama'], usageName: 'ollama',
    kind: 'ollama', connection: 'ollama', credentialKind: 'default',
    baseUrl: 'https://api.ollama.com/v1', readBaseUrlFromConnection: true,
    solo: true
  },
  {
    key: 'airforce', label: 'API.airforce', combo: 'airforce-free',
    prefixes: ['api-airforce', 'airforce'], usageName: 'api-airforce',
    kind: 'airforce', connection: 'api-airforce', credentialKind: 'default',
    baseUrl: 'https://api.airforce/v1', readBaseUrlFromConnection: true,
    solo: true, throttleMs: 1200
  },
  {
    key: 'bazaarlink', label: 'Bazaarlink', combo: 'bazaarlink-free',
    prefixes: ['bazaarlink', 'bzl'], usageName: 'bazaarlink',
    kind: 'bazaarlink', connection: 'bazaarlink', credentialKind: 'default',
    baseUrl: 'https://bazaarlink.ai/api/v1', readBaseUrlFromConnection: true
  },
  {
    key: 'bai', label: 'B.ai', combo: 'b.ai-free',
    prefixes: ['b-ai', 'b.ai', 'bai'], usageName: 'b.ai',
    kind: 'bai', connection: 'b.ai', credentialKind: 'bai',
    baseUrl: 'https://api.b.ai/v1'
  },
  {
    key: 'groq', label: 'Groq', combo: 'groq-free',
    prefixes: ['groq'], usageName: 'groq',
    kind: 'openai-compatible', connection: 'groq', credentialKind: 'default',
    baseUrl: 'https://api.groq.com/openai/v1',
    skipPatterns: ['whisper', 'tts', 'guard', 'embed', 'playai']
  },
  {
    key: 'cerebras', label: 'Cerebras', combo: 'cerebras-free',
    prefixes: ['cerebras'], usageName: 'cerebras',
    kind: 'openai-compatible', connection: 'cerebras', credentialKind: 'default',
    baseUrl: 'https://api.cerebras.ai/v1',
    skipPatterns: ['embed']
  },
  {
    key: 'mistral', label: 'Mistral', combo: 'mistral-free',
    prefixes: ['mistral'], usageName: 'mistral',
    kind: 'openai-compatible', connection: 'mistral', credentialKind: 'default',
    baseUrl: 'https://api.mistral.ai/v1',
    // Paid-only / non-coding entries; anything else that needs payment is dropped
    // by the live pre-test (HTTP 402/403)
    skipPatterns: ['embed', 'moderation', 'ocr', 'tts', 'voxtral', 'mistral-saba']
  },
  {
    key: 'cloudflare', label: 'Cloudflare Workers AI', combo: 'cloudflare-free',
    prefixes: ['cloudflare-ai', 'cloudflare', 'cf'], usageName: 'cloudflare',
    kind: 'cloudflare', connection: 'cloudflare-ai', credentialKind: 'cloudflare'
  },
  {
    key: 'nvidia', label: 'NVIDIA NIM', combo: 'nvidia-free',
    prefixes: ['nvidia', 'nim'], usageName: 'nvidia',
    kind: 'openai-compatible', connection: 'nvidia', credentialKind: 'default',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    // The catalog response carries no pricing fields: every model on
    // integrate.api.nvidia.com runs on free developer credits, so usability is
    // decided by the live pre-test. Skip patterns only remove non-LLM entries.
    skipPatterns: [
      // embeddings / retrieval / document parsing
      'embed', 'bge-m3', 'arctic', 'rerank', 'retriever', 'parse',
      // audio / speech / translation
      'tts', 'speech', 'audio', 'asr', 'riva', 'parakeet', 'whisper',
      // vision / image / video
      'vision', '-vl', 'vlm', 'fuyu', 'kosmos', 'neva', 'vila', 'deplot', 'clip', 'diffusion', 'image', 'video', 'detector',
      // guardrails / reward models
      'guard', 'safety', 'topic-control', 'reward', 'moderation'
    ]
  }
];

const PROVIDER_BY_KEY = Object.fromEntries(PROVIDERS.map(p => [p.key, p]));

// Find a provider record by any model-id first segment / alias spelling
function providerByPrefix(prefix) {
  const head = String(prefix || '').toLowerCase();
  return PROVIDERS.find(p => p.prefixes.includes(head)) || null;
}

module.exports = { PROVIDERS, PROVIDER_BY_KEY, providerByPrefix };
