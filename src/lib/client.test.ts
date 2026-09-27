import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeResponse, examples, generate, type GenerationEvent } from './client'
async function collect(stream: AsyncGenerator<GenerationEvent>) { const events: GenerationEvent[] = []; for await (const event of stream) events.push(event); return events }
const request = { prompt: 'hello', maxTokens: 256, temperature: 0.7 }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('generation boundary', () => {
  it('posts the configured request and preserves reported metrics', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Hello', metrics: { ttftMs: 12, outputTokens: 1 } }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    const events = await collect(generate(request, signal, { mode: 'live', baseUrl: 'https://example.test/api/' }))
    expect(fetcher).toHaveBeenCalledWith('https://example.test/api/generate', expect.objectContaining({ method: 'POST', signal, body: JSON.stringify({ prompt: 'hello', max_tokens: 256, temperature: 0.7 }) }))
    expect(events).toEqual([{ type: 'delta', text: 'Hello' }, { type: 'metrics', metrics: { ttftMs: 12, outputTokens: 1 } }])
  })
  it('rejects HTTP and unsupported stream responses without falling back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('data: hello', { headers: { 'Content-Type': 'text/event-stream' } })))
    const settings = { mode: 'live' as const, baseUrl: 'https://example.test' }
    await expect(collect(generate(request, new AbortController().signal, settings))).rejects.toThrow('503')
    await expect(collect(generate(request, new AbortController().signal, settings))).rejects.toThrow('streaming adapter')
  })
  it('validates response shape and does not fabricate missing or invalid metrics', () => {
    expect(() => decodeResponse({ choices: [] })).toThrow('Unsupported API response')
    expect(decodeResponse({ text: 'ok', metrics: { ttftMs: -1, outputTokens: 1.5, totalLatencyMs: 0, decodeTokensPerSecond: '100' } })).toEqual({ text: 'ok', metrics: { totalLatencyMs: 0 } })
  })
  it('cancels sample playback promptly', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const stream = generate(request, controller.signal, { mode: 'mock', baseUrl: '' })
    const pending = stream.next()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('plays the authored sample without claiming token or timing measurements', async () => {
    vi.useFakeTimers()
    const pending = collect(generate({ ...request, prompt: examples[0].prompt }, new AbortController().signal, { mode: 'mock', baseUrl: '' }))
    await vi.runAllTimersAsync()
    const events = await pending
    expect(events.every(event => event.type === 'delta')).toBe(true)
    expect(events.map(event => event.type === 'delta' ? event.text : '').join('')).toBe(examples[0].answer)
  })
})
