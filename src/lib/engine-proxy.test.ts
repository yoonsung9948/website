import { afterEach, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../functions/api/start_engine'
import { NoGpuAvailableError, requestEngineStart } from './engine'

afterEach(() => vi.unstubAllGlobals())
const env = { ORIGIN_URL: 'https://control.test/', DEMO_KEY: 'test-only-key' }
it.each([
  [202, { status: 'starting' }],
  [503, { error: 'no_gpu_available' }],
])('preserves backend status %s and its JSON through the proxy', async (status, body) => {
  const upstream = vi.fn().mockResolvedValue(Response.json(body, { status, headers: { 'Retry-After': '60' } }))
  vi.stubGlobal('fetch', upstream)
  const response = await onRequestPost({ env })
  expect(response.status).toBe(status)
  expect(response.headers.get('Content-Type')).toContain('application/json')
  expect(response.headers.get('Retry-After')).toBe('60')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(upstream).toHaveBeenCalledWith('https://control.test/start_engine', expect.objectContaining({ method: 'POST', headers: { 'X-Demo-Key': 'test-only-key' } }))
  // Feed the actual proxy response into the browser adapter.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  const result = requestEngineStart(new AbortController().signal, { mode: 'live', baseUrl: '/api' })
  if (status === 503) await expect(result).rejects.toBeInstanceOf(NoGpuAvailableError)
  else await expect(result).resolves.toBeUndefined()
})
