import { afterEach, expect, it, vi } from 'vitest'
import { generate } from './client'
import { EngineCapacityError, InvalidExecutionError, GenerationCapacityError, RequestRateLimitError } from './api-errors'
const settings = { mode: 'live' as const, baseUrl: '/api' }
const request = { prompt: 'hello', model: 'configured', maxTokens: 8, temperature: 0 }
afterEach(() => vi.unstubAllGlobals())
it('distinguishes request frequency from occupied generation slots', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'request_rate_limited' }, { status: 429, headers: { 'Retry-After': '2' } }))
    .mockResolvedValueOnce(Response.json({ error: 'generation_capacity' }, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  const error = await generate(request, signal, settings).next().catch(error => error)
  expect(error).toBeInstanceOf(RequestRateLimitError)
  expect(error.retryAt).toBeGreaterThan(Date.now())
  await expect(generate(request, signal, settings).next()).rejects.toBeInstanceOf(GenerationCapacityError)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('keeps unknown errors distinct and does not automatically retry', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('proxy unavailable', { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(generate(request, new AbortController().signal, settings).next()).rejects.toThrow('HTTP 503')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('distinguishes worker capacity from invalid execution settings', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('engine rejected request', { status: 503, headers: { 'X-Relay-Rejection': 'engine_capacity' } }))
    .mockResolvedValueOnce(new Response('engine rejected request', { status: 422 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(generate(request, new AbortController().signal, settings).next()).rejects.toBeInstanceOf(EngineCapacityError)
  await expect(generate(request, new AbortController().signal, settings).next()).rejects.toBeInstanceOf(InvalidExecutionError)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
