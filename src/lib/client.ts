import { readSSE } from './sse'
import type { CacheMode } from './engine-info'
import { EngineCapacityError, InvalidExecutionError, GenerationCapacityError, readApiFailure, RequestRateLimitError } from './api-errors'

export type Metrics = {
  ttftMs?: number; decodeTokensPerSecond?: number; outputTokens?: number; totalLatencyMs?: number
  inputTokens?: number; prefillMs?: number; initialQueueMs?: number; decodeDurationMs?: number
  decodeSteps?: number; decodeBatchSizeMax?: number; decodeBatchSizeMean?: number
}
export type GenerationRequest = { prompt: string; model: string; maxTokens: number; temperature: number; kvCacheMode?: CacheMode; decodeBatching?: boolean }
export const models = [{ id: 'configured', label: 'Configured engine' }] as const
export type ModelId = (typeof models)[number]['id']
export type GenerationEvent = { type: 'delta'; text: string } | { type: 'metrics'; metrics: Metrics } | { type: 'generation'; generation: GenerationMetadata } | { type: 'completion'; requestId?: string; finishReason?: string }
export type GenerationMetadata = {
  model?: string; sampling?: string; max_tokens?: number; temperature?: number
  kv_cache_mode?: CacheMode; decode_batching?: boolean; backend?: string; dtype?: string
  engine_revision?: string; model_revision?: string; config_sha256?: string; engine_source_sha256?: string
  device_name?: string; implementation_version?: string
}
export const REQUEST_TIMEOUT_MS = 190_000
export type ApiConfig = { mode: 'mock' | 'live'; baseUrl: string }
export const config: ApiConfig = {
  mode: import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock',
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').trim(),
}
export const examples = [
  { label: 'KV cache', prompt: 'Explain what a KV cache does during language model inference.', answer: 'A KV cache saves the key and value vectors computed by attention for tokens the model has already seen.\n\nWhen generating the next token, the model computes new keys and values only for that token, then attends to the cached history. This avoids recomputing the entire prefix at every decoding step.\n\nThe tradeoff is memory: the cache grows with context length, batch size, and the number of attention layers. Managing that memory efficiently is a central problem in inference serving.' },
  { label: 'Continuous batching', prompt: 'How does continuous batching improve inference throughput?', answer: 'Continuous batching updates the active batch at each decoding step. When one request finishes, another can take its place without waiting for every sequence in the batch to complete.\n\nThis keeps the GPU busy despite requests having different output lengths. The scheduler must balance throughput with latency, while respecting the memory available for each request’s KV cache.' },
  { label: 'Prefill vs. decode', prompt: 'What is the difference between prefill and decode?', answer: 'Prefill processes the input prompt and builds its KV cache. Many prompt tokens can be processed in parallel, making this phase relatively compute intensive.\n\nDecode generates output one token at a time, reusing the cached keys and values. At small batch sizes, moving model weights and cache data often dominates the cost.\n\nTime to first token captures the wait before output begins. Decode throughput describes how quickly subsequent tokens arrive.' },
]
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
/** The server remains authoritative for work limits; the UI uses live capabilities. */
export function encodeRequest(request: GenerationRequest) {
  const mode = request.kvCacheMode ?? 'none'
  if (!['none', 'dynamic', 'pool'].includes(mode) || (request.decodeBatching && mode !== 'pool')) throw new Error('Decode batching requires pooled cache.')
  if (!Number.isFinite(request.temperature) || request.temperature < 0) throw new Error('Temperature must be finite and nonnegative.')
  if (!Number.isInteger(request.maxTokens) || request.maxTokens < 0) throw new Error('Max tokens must be a nonnegative integer.')
  return { prompt: request.prompt, max_tokens: request.maxTokens, temperature: request.temperature, stream: true, kv_cache_mode: mode, decode_batching: request.decodeBatching ?? false }
}

export function decodeGeneration(value: Record<string, unknown>): GenerationMetadata {
  const result: Record<string, unknown> = {}
  for (const key of ['model', 'sampling', 'backend', 'dtype', 'engine_revision', 'model_revision', 'config_sha256', 'engine_source_sha256', 'device_name', 'implementation_version']) if (typeof value[key] === 'string') result[key] = value[key]
  if (typeof value.max_tokens === 'number' && Number.isInteger(value.max_tokens) && value.max_tokens >= 0) result.max_tokens = value.max_tokens
  if (typeof value.temperature === 'number' && Number.isFinite(value.temperature) && value.temperature >= 0) result.temperature = value.temperature
  if (['none', 'dynamic', 'pool'].includes(String(value.kv_cache_mode))) result.kv_cache_mode = value.kv_cache_mode
  if (typeof value.decode_batching === 'boolean') result.decode_batching = value.decode_batching
  return result as GenerationMetadata
}

export function decodeMetrics(value: unknown): Metrics {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || raw.source !== 'engine') return {}
  const metrics: Metrics = {}
  const fields = { ttftMs: 'ttft_ms', decodeTokensPerSecond: 'decode_tokens_per_second', outputTokens: 'output_tokens', totalLatencyMs: 'total_latency_ms', inputTokens: 'input_tokens', prefillMs: 'prefill_ms', initialQueueMs: 'initial_queue_ms', decodeDurationMs: 'decode_duration_ms', decodeSteps: 'decode_steps', decodeBatchSizeMax: 'decode_batch_size_max', decodeBatchSizeMean: 'decode_batch_size_mean' } as const
  for (const key of Object.keys(fields) as (keyof Metrics)[]) {
    const value = raw[fields[key]]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!['inputTokens', 'outputTokens', 'decodeSteps', 'decodeBatchSizeMax'].includes(key) || Number.isInteger(value)) && (key !== 'decodeBatchSizeMean' || value >= 1)) metrics[key] = value
  }
  return metrics
}

export function decodeResponse(value: unknown): { text: string; metrics: Metrics } {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') throw new Error('Invalid generation response.')
  return { text: value.text, metrics: decodeMetrics('metrics' in value ? value.metrics : undefined) }
}

export async function* generate(request: GenerationRequest, signal: AbortSignal, settings = config): AsyncGenerator<GenerationEvent> {
  signal.throwIfAborted()
  if (settings.mode === 'mock') {
    const sample = examples.find(example => example.prompt === request.prompt.trim())
    const text = sample?.answer ?? 'This is a sample response to preview the interface. No model is connected, so this playback does not answer your custom prompt.\n\nChoose one of the example prompts to explore an authored response. Live generation becomes available when the API connection is configured.'
    await delay(350, signal)
    // Playback chunks are words, not model tokens. Never present them as tokens.
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      await delay(28, signal)
      yield { type: 'delta', text: chunk }
    }
    return
  }
  if (!settings.baseUrl) throw new Error('Live mode requires VITE_API_BASE_URL. Configure it and rebuild the frontend.')
  const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(encodeRequest(request)), signal,
  })
  if (!response.ok) {
    const rejection = response.headers.get('X-Relay-Rejection')
    const { code, retryAt } = await readApiFailure(response)
    if (response.status === 429 && code === 'request_rate_limited') throw new RequestRateLimitError(retryAt)
    if (response.status === 422) throw new InvalidExecutionError()
    if (response.status === 503 && rejection === 'engine_capacity') throw new EngineCapacityError()
    if (response.status === 503 && code === 'generation_capacity') throw new GenerationCapacityError()
    throw new Error(`Generation failed (HTTP ${response.status}). Try again or check the API connection.`)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Expected an SSE generation stream.')
  for await (const frame of readSSE(response.body, signal)) {
    let event: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(frame.data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      event = parsed as Record<string, unknown>
    } catch { throw new Error('Invalid generation stream event.') }
    if (frame.event === 'error' || event.type === 'error') throw new Error(typeof event.error === 'string' ? event.error : 'Generation failed.')
    if (event.type === 'delta') {
      if (typeof event.text !== 'string') throw new Error('Invalid text delta.')
      if (event.text) yield { type: 'delta', text: event.text }
    } else if (event.type === 'done') {
      if (event.generation && typeof event.generation === 'object') {
        yield { type: 'generation', generation: decodeGeneration(event.generation as Record<string, unknown>) }
      }
      if (typeof event.request_id === 'string' || typeof event.finish_reason === 'string') {
        yield { type: 'completion', requestId: typeof event.request_id === 'string' ? event.request_id : undefined,
          finishReason: typeof event.finish_reason === 'string' ? event.finish_reason : undefined }
      }
      yield { type: 'metrics', metrics: decodeMetrics(event.metrics) }
      return
    } else throw new Error('Unknown generation stream event.')
  }
  throw new Error('Generation stream ended before completion.')
}
