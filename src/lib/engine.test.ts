import { afterEach, expect, it, vi } from 'vitest'
import { NoGpuAvailableError, readEngineState, requestEngineStart } from './engine'
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
