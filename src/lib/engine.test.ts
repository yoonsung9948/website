import { afterEach, expect, it, vi } from 'vitest'
import { readEngineState, requestEngineStart } from './engine'
const settings = { mode: 'live' as const, baseUrl: '/api/' }
afterEach(() => vi.unstubAllGlobals())
it('uses the proxy route without putting the demo key in the browser', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('Starting engine...Engine started successfully.'))
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  await requestEngineStart(signal, settings)
  expect(fetcher).toHaveBeenCalledWith('/api/start_engine', { method: 'POST', signal })
})
it('rejects legacy errors even when the handler has already sent HTTP 200', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Starting engine...error starting engine')))
  await expect(requestEngineStart(new AbortController().signal, settings)).rejects.toThrow('not accepted')
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
