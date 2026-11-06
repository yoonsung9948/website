import { afterEach, expect, it, vi } from 'vitest'
import { CooldownError, EngineStateConflictError, parseRetryAfter, NoGpuAvailableError, readEngineState, requestEngineStart } from './engine'
const settings = { mode: 'live' as const, baseUrl: '/api/' }
afterEach(() => vi.unstubAllGlobals())
it('uses the proxy route without putting the demo key in the browser', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'starting' }, { status: 202 }))
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  await requestEngineStart(signal, settings)
  expect(fetcher).toHaveBeenCalledWith('/api/start_engine', { method: 'POST', signal })
})
it('maps the no-capacity response to a helpful, retryable error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'no_gpu_available' }, { status: 503 })))
  const result = requestEngineStart(new AbortController().signal, settings)
  await expect(result).rejects.toBeInstanceOf(NoGpuAvailableError)
  await expect(result).rejects.toThrow('No GPUs are available right now. Please try again in a few minutes.')
})
it('keeps plain-text and unrelated service failures distinct from no capacity', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response('error starting engine', { status: 500 }))
    .mockResolvedValueOnce(new Response('engine connection not configured', { status: 503 })))
  await expect(requestEngineStart(new AbortController().signal, settings)).rejects.toThrow('HTTP 500')
  await expect(requestEngineStart(new AbortController().signal, settings)).rejects.toThrow('HTTP 503')
})
it('does not mistake malformed success responses for accepted startup', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not an API</html>')))
  await expect(requestEngineStart(new AbortController().signal, settings)).rejects.toThrow('unexpected startup response')
})
it('only accepts a known health state and does not confuse an HTTP success with readiness', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ state: 'loading_model' })).mockResolvedValueOnce(Response.json({ state: 'not-a-state' })))
  expect(await readEngineState(new AbortController().signal, settings)).toBe('loading_model')
  await expect(readEngineState(new AbortController().signal, settings)).rejects.toThrow('unrecognized')
})
it('never starts infrastructure in sample mode', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(requestEngineStart(new AbortController().signal, { mode: 'mock', baseUrl: '/api' })).rejects.toThrow('live mode')
  expect(fetcher).not.toHaveBeenCalled()
})

it('reads delay seconds and HTTP dates without inventing missing deadlines', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  expect(parseRetryAfter('15', now)).toBe(now + 15_000)
  expect(parseRetryAfter('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(now + 60_000)
  for (const value of [null, '', 'garbage', '-3', '1.5', 'Infinity']) expect(parseRetryAfter(value, now)).toBeNull()
  expect(parseRetryAfter('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(now)
})
it('maps 429 to a typed cooldown with the backend deadline', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'provision_cooldown' }, { status: 429, headers: { 'Retry-After': '15' } })))
  const error = await requestEngineStart(new AbortController().signal, settings).catch(error => error)
  expect(error).toBeInstanceOf(CooldownError)
  expect(error.retryAt).toBe(16_000)
  vi.restoreAllMocks()
})
it('preserves a capacity backoff without requiring a header', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'no_gpu_available' }, { status: 503, headers: { 'Retry-After': '15' } })))
  const before = Date.now()
  const error = await requestEngineStart(new AbortController().signal, settings).catch(error => error)
  expect(error).toBeInstanceOf(NoGpuAvailableError)
  expect(error.retryAt).toBeGreaterThanOrEqual(before + 15_000)
})
it('does not retry an unconfirmed network failure', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Network error'))
  vi.stubGlobal('fetch', fetcher)
  await expect(requestEngineStart(new AbortController().signal, settings)).rejects.toThrow('Network error')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('only treats a provisioning cooldown code as a cooldown', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'other_limit' }, { status: 429 }))
  vi.stubGlobal('fetch', fetcher)
  const error = await requestEngineStart(new AbortController().signal, settings).catch(error => error)
  expect(error).not.toBeInstanceOf(CooldownError)
  expect(error.message).toContain('HTTP 429')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('reports a startup conflict for status reconciliation without repeating the POST', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'engine_state_conflict' }, { status: 409 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(requestEngineStart(new AbortController().signal, settings)).rejects.toBeInstanceOf(EngineStateConflictError)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
