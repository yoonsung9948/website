import { afterEach, expect, it, vi } from 'vitest'
import { decodeMetrics, encodeRequest, examples, generate, type GenerationEvent } from './client'

const request = { prompt: 'hello', model: 'configured', maxTokens: 64, temperature: 0 }
const settings = { mode: 'live' as const, baseUrl: '/api/' }
const signal = () => new AbortController().signal
const collect = async (events: AsyncGenerator<GenerationEvent>) => { const result = []; for await (const event of events) result.push(event); return result }
const metrics = { version: 1, source: 'engine', input_tokens: 2, output_tokens: 3, ttft_ms: 0, decode_tokens_per_second: null, total_latency_ms: 12 }
function response(text: string, bytewise = false) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    else controller.enqueue(bytes)
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
const done = `event: done\ndata: ${JSON.stringify({ type: 'done', metrics, generation: { model: 'Qwen/Qwen3-8B', sampling: 'greedy', max_tokens: 64 } })}\n\n`
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('requests SSE and preserves measured zero/null values and effective metadata', async () => {
  const fetcher = vi.fn().mockResolvedValue(response('data: {"type":"delta","text":"hello"}\n\n' + done))
  vi.stubGlobal('fetch', fetcher)
  const result = await collect(generate(request, signal(), settings))
  expect(fetcher).toHaveBeenCalledWith('/api/generate', expect.objectContaining({
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ prompt: 'hello', max_tokens: 64, temperature: 0, stream: true, kv_cache_mode: 'none', decode_batching: false }),
  }))
  expect(result).toEqual([
    { type: 'delta', text: 'hello' },
    { type: 'generation', generation: { model: 'Qwen/Qwen3-8B', sampling: 'greedy', max_tokens: 64 } },
    { type: 'metrics', metrics: { ttftMs: 0, outputTokens: 3, totalLatencyMs: 12, inputTokens: 2 } },
  ])
})

it('decodes fragmented UTF-8, CRLF, comments, and multiline SSE data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(': heartbeat\r\ndata: {"type":"delta",\r\ndata: "text":"안녕 🌍"}\r\n\r\n' + done, true)))
  expect((await collect(generate(request, signal(), settings)))[0]).toEqual({ type: 'delta', text: '안녕 🌍' })
})

it('delivers text before the terminal event and closes the reader afterward', async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) { writer = controller; controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"early"}\n\n')) },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'text/event-stream' } })))
  const stream = generate(request, signal(), settings)
  expect(await stream.next()).toEqual({ done: false, value: { type: 'delta', text: 'early' } })
  writer.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'))
  expect(await collect(stream)).toEqual([{ type: 'metrics', metrics: {} }])
  expect(cancelled).toBe(true)
})

it.each([
  ['data: {"type":"delta","text":"partial"}\n\n', 'before completion'],
  ['event: error\ndata: {"type":"error","error":"Generation failed"}\n\n', 'Generation failed'],
  ['data: not-json\n\n', 'Invalid generation'],
  ['data: {"type":"unknown"}\n\n', 'Unknown generation'],
])('rejects incomplete or failed streams', async (body, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)))
  await expect(collect(generate(request, signal(), settings))).rejects.toThrow(message)
})

it('does not fabricate missing, invalid, or unsupported measurements', () => {
  expect(decodeMetrics(undefined)).toEqual({})
  expect(decodeMetrics({ ...metrics, version: 2 })).toEqual({})
  expect(decodeMetrics({ ...metrics, ttft_ms: -1, output_tokens: 1.5 })).toEqual({ totalLatencyMs: 12, inputTokens: 2 })
})

it('propagates Stop and releases the response reader', async () => {
  const controller = new AbortController()
  let cancelled = false
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(writer) { writer.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"partial"}\n\n')) },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'text/event-stream' } })))
  const stream = generate(request, controller.signal, settings)
  await stream.next()
  const pending = stream.next()
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(cancelled).toBe(true)
})

it('rejects HTTP failures before reading the body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
  await expect(collect(generate(request, signal(), settings))).rejects.toThrow('429')
})

it('sample playback never claims measured performance', async () => {
  vi.useFakeTimers()
  const pending = collect(generate({ ...request, prompt: examples[0].prompt }, signal(), { mode: 'mock', baseUrl: '' }))
  await vi.runAllTimersAsync()
  const result = await pending
  expect(result.every(event => event.type === 'delta')).toBe(true)
})

it('sends explicit execution modes, temperature, and output limits above 64', () => {
  expect(encodeRequest({ ...request, maxTokens: 256, temperature: 0.7, kvCacheMode: 'pool', decodeBatching: true })).toMatchObject({ max_tokens: 256, temperature: 0.7, kv_cache_mode: 'pool', decode_batching: true })
  expect(() => encodeRequest({ ...request, kvCacheMode: 'dynamic', decodeBatching: true })).toThrow('pooled')
  expect(() => encodeRequest({ ...request, temperature: NaN })).toThrow('Temperature')
})
it('preserves rich terminal metadata and nullable metrics without manufacturing values', async () => {
  const data = { type: 'done', request_id: 'request-123', finish_reason: 'length', generation: { model: 'Qwen', kv_cache_mode: 'pool', decode_batching: true, temperature: 0, engine_revision: 'abc' }, metrics: { ...metrics, prefill_ms: 0, initial_queue_ms: null, decode_duration_ms: 10, decode_steps: 2, decode_batch_size_max: 2, decode_batch_size_mean: 1.5 } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(`data: ${JSON.stringify(data)}\n\n`)))
  const result = await collect(generate(request, signal(), settings))
  expect(result).toContainEqual({ type: 'completion', requestId: 'request-123', finishReason: 'length' })
  expect(result).toContainEqual({ type: 'generation', generation: data.generation })
  expect(result.at(-1)).toEqual({ type: 'metrics', metrics: { ttftMs: 0, inputTokens: 2, outputTokens: 3, totalLatencyMs: 12, prefillMs: 0, decodeDurationMs: 10, decodeSteps: 2, decodeBatchSizeMax: 2, decodeBatchSizeMean: 1.5 } })
})
