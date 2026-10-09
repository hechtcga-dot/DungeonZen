// The AI services the DM can choose between (Settings › AI services).
// Text services write (scene text, notes import); image services draw battle maps.
// Model names are suggestions only: the DM can type any model the service offers,
// or fetch the service's own list. Keys are stored with Electron safeStorage (rule 7).

export type AiKind = 'text' | 'image'

/** How the app talks to the service. */
export type AiProtocol =
  | 'anthropic' // Anthropic Messages API
  | 'openai' // OpenAI-compatible chat completions (OpenAI, OpenRouter, Mistral, Groq, Ollama…)
  | 'gemini' // Google Gemini generateContent
  | 'openai-image' // OpenAI Images API
  | 'gemini-image' // Gemini image output
  | 'stability' // Stability AI Stable Image
  | 'replicate' // Replicate predictions (Flux and others)
  | 'fal' // fal.ai (Flux and others)
  | 'sd-webui' // AUTOMATIC1111 / Forge web UI on this computer

export interface AiProviderInfo {
  id: string
  kind: AiKind
  name: string
  protocol: AiProtocol
  /** One line on what it is and what it costs to run. */
  blurb: string
  needsKey: boolean
  /** Where the DM gets a key or downloads the program. */
  keyUrl?: string
  baseUrl: string
  /** True when the DM may change the address (local programs and custom services). */
  editableUrl: boolean
  defaultModel: string
  models: string[]
  /** True when it runs on this computer: works offline, no key. */
  local?: boolean
  /** True when it can take example images (style references). */
  references?: boolean
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  // ---- writing ----
  {
    id: 'anthropic', kind: 'text', name: 'Anthropic Claude', protocol: 'anthropic', needsKey: true,
    blurb: 'Strong at long notes and careful writing. Pay per use.',
    keyUrl: 'https://console.anthropic.com/settings/keys', baseUrl: 'https://api.anthropic.com', editableUrl: false,
    defaultModel: 'claude-sonnet-5-5', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001']
  },
  {
    id: 'openai', kind: 'text', name: 'OpenAI (ChatGPT)', protocol: 'openai', needsKey: true,
    blurb: 'The models behind ChatGPT. Pay per use; separate from a ChatGPT subscription.',
    keyUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1', editableUrl: false,
    defaultModel: 'gpt-5-mini', models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini']
  },
  {
    id: 'gemini', kind: 'text', name: 'Google Gemini', protocol: 'gemini', needsKey: true,
    blurb: 'Fast and low cost, with a free tier for light use.',
    keyUrl: 'https://aistudio.google.com/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', editableUrl: false,
    defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']
  },
  {
    id: 'openrouter', kind: 'text', name: 'OpenRouter', protocol: 'openai', needsKey: true,
    blurb: 'One key for hundreds of models from many companies. Pay per use.',
    keyUrl: 'https://openrouter.ai/keys', baseUrl: 'https://openrouter.ai/api/v1', editableUrl: false,
    defaultModel: 'openrouter/auto', models: ['openrouter/auto']
  },
  {
    id: 'mistral', kind: 'text', name: 'Mistral', protocol: 'openai', needsKey: true,
    blurb: 'European models, low cost. Pay per use, free tier for testing.',
    keyUrl: 'https://console.mistral.ai/api-keys', baseUrl: 'https://api.mistral.ai/v1', editableUrl: false,
    defaultModel: 'mistral-small-latest', models: ['mistral-small-latest', 'mistral-large-latest']
  },
  {
    id: 'groq', kind: 'text', name: 'Groq', protocol: 'openai', needsKey: true,
    blurb: 'Open models that answer very fast, handy during play. Free tier.',
    keyUrl: 'https://console.groq.com/keys', baseUrl: 'https://api.groq.com/openai/v1', editableUrl: false,
    defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile']
  },
  {
    id: 'deepseek', kind: 'text', name: 'DeepSeek', protocol: 'openai', needsKey: true,
    blurb: 'Very low cost per use.',
    keyUrl: 'https://platform.deepseek.com/api_keys', baseUrl: 'https://api.deepseek.com/v1', editableUrl: false,
    defaultModel: 'deepseek-chat', models: ['deepseek-chat']
  },
  {
    id: 'xai', kind: 'text', name: 'xAI Grok', protocol: 'openai', needsKey: true,
    blurb: 'Grok models. Pay per use.',
    keyUrl: 'https://console.x.ai', baseUrl: 'https://api.x.ai/v1', editableUrl: false,
    defaultModel: 'grok-4', models: ['grok-4']
  },
  {
    id: 'ollama', kind: 'text', name: 'Ollama (on this computer)', protocol: 'openai', needsKey: false, local: true,
    blurb: 'Free and offline. Install Ollama and download a model; needs a good computer.',
    keyUrl: 'https://ollama.com/download', baseUrl: 'http://localhost:11434/v1', editableUrl: true,
    defaultModel: 'llama3.1', models: ['llama3.1', 'qwen2.5', 'mistral']
  },
  {
    id: 'lmstudio', kind: 'text', name: 'LM Studio (on this computer)', protocol: 'openai', needsKey: false, local: true,
    blurb: 'Free and offline. Start LM Studio\'s local server with a model loaded.',
    keyUrl: 'https://lmstudio.ai', baseUrl: 'http://localhost:1234/v1', editableUrl: true,
    defaultModel: 'local-model', models: []
  },
  {
    id: 'custom-text', kind: 'text', name: 'Other (OpenAI-compatible)', protocol: 'openai', needsKey: false,
    blurb: 'Any service that speaks the OpenAI chat format: type its address and model.',
    baseUrl: 'https://', editableUrl: true, defaultModel: '', models: []
  },
  // ---- battle maps ----
  {
    id: 'openai-image', kind: 'image', name: 'OpenAI images', protocol: 'openai-image', needsKey: true, references: true,
    blurb: 'Follows detailed instructions well and takes example maps. Pay per image.',
    keyUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1', editableUrl: false,
    defaultModel: 'gpt-image-1', models: ['gpt-image-1', 'gpt-image-1-mini']
  },
  {
    id: 'gemini-image', kind: 'image', name: 'Google Gemini images', protocol: 'gemini-image', needsKey: true, references: true,
    blurb: 'Takes several example maps at once for the style. Pay per image.',
    keyUrl: 'https://aistudio.google.com/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', editableUrl: false,
    defaultModel: 'gemini-2.5-flash-image', models: ['gemini-2.5-flash-image']
  },
  {
    id: 'stability', kind: 'image', name: 'Stability AI', protocol: 'stability', needsKey: true, references: true,
    blurb: 'Stable Diffusion in the cloud; can copy a style from an example. Pay per image.',
    keyUrl: 'https://platform.stability.ai/account/keys', baseUrl: 'https://api.stability.ai', editableUrl: false,
    defaultModel: 'core', models: ['core', 'ultra', 'sd3.5-large']
  },
  {
    id: 'replicate', kind: 'image', name: 'Replicate (Flux and others)', protocol: 'replicate', needsKey: true,
    blurb: 'Runs Flux and many other image models. Cheap per image.',
    keyUrl: 'https://replicate.com/account/api-tokens', baseUrl: 'https://api.replicate.com/v1', editableUrl: false,
    defaultModel: 'black-forest-labs/flux-schnell', models: ['black-forest-labs/flux-schnell', 'black-forest-labs/flux-1.1-pro', 'black-forest-labs/flux-dev']
  },
  {
    id: 'fal', kind: 'image', name: 'fal.ai (Flux and others)', protocol: 'fal', needsKey: true,
    blurb: 'Runs Flux and other image models quickly. Cheap per image.',
    keyUrl: 'https://fal.ai/dashboard/keys', baseUrl: 'https://fal.run', editableUrl: false,
    defaultModel: 'fal-ai/flux/schnell', models: ['fal-ai/flux/schnell', 'fal-ai/flux/dev', 'fal-ai/flux-pro/v1.1']
  },
  {
    id: 'sd-webui', kind: 'image', name: 'Stable Diffusion (on this computer)', protocol: 'sd-webui', needsKey: false, local: true,
    blurb: 'Free and offline with AUTOMATIC1111 or Forge started with --api. Needs a graphics card.',
    keyUrl: 'https://github.com/lllyasviel/stable-diffusion-webui-forge', baseUrl: 'http://127.0.0.1:7860', editableUrl: true,
    defaultModel: '', models: []
  }
]

export function providerById(id: string): AiProviderInfo | undefined {
  return AI_PROVIDERS.find((p) => p.id === id)
}

/** What the DM picked for one kind of work. */
export interface AiChoice {
  provider: string | null
  model: string
  baseUrl: string
}

/** How many example pictures (style references) a service takes with one drawing. */
export function maxReferences(info: AiProviderInfo | null | undefined): number {
  if (!info?.references) return 0
  return info.protocol === 'stability' ? 1 : 4
}
