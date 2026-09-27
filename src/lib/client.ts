export type Metrics = { ttftMs?: number; decodeTokensPerSecond?: number; outputTokens?: number; totalLatencyMs?: number }
export type GenerationRequest = { prompt: string; maxTokens: number; temperature: number }
export type GenerationEvent = { type: 'delta'; text: string } | { type: 'metrics'; metrics: Metrics }
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
/** Integration seam: replace these two adapters when the Go API contract is known.
 * This optional JSON contract is a frontend convention, not a claimed engine protocol.
 * Do not infer tokens or TTFT from network chunks or word counts.
 */
export function encodeRequest(request: GenerationRequest) {
  return { prompt: request.prompt, max_tokens: request.maxTokens, temperature: request.temperature }
}
export function decodeResponse(value: unknown): { text: string; metrics: Metrics } {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') {
    throw new Error('Unsupported API response. Connect the response adapter in src/lib/client.ts to your API contract.')
  }
  const metrics: Metrics = {}
  if ('metrics' in value && value.metrics && typeof value.metrics === 'object') {
    const raw = value.metrics as Record<string, unknown>
    for (const key of ['ttftMs', 'decodeTokensPerSecond', 'outputTokens', 'totalLatencyMs'] as const) {
      const metric = raw[key]
      if (typeof metric === 'number' && Number.isFinite(metric) && metric >= 0 && (key !== 'outputTokens' || Number.isInteger(metric))) metrics[key] = metric
    }
  }
  return { text: value.text, metrics }
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
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(encodeRequest(request)), signal,
  })
  if (!response.ok) throw new Error(`Generation failed (HTTP ${response.status}). Try again or check the API connection.`)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('This API uses a different response protocol. Add its streaming adapter in src/lib/client.ts.')
  const result = decodeResponse(await response.json())
  signal.throwIfAborted()
  yield { type: 'delta', text: result.text }
  yield { type: 'metrics', metrics: result.metrics }
}
