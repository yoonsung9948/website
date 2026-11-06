import { afterEach, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../functions/api/generate'

const env = { ORIGIN_URL: 'https://control.test/', DEMO_KEY: 'server-only-key' }
afterEach(() => vi.unstubAllGlobals())
it('preserves streaming, errors, headers, and downstream cancellation', async () => {
  const controller = new AbortController()
  const request = new Request('https://site.test/api/generate', { method: 'POST', body: '{"stream":true}', signal: controller.signal })
  const upstream = vi.fn().mockResolvedValue(new Response('data: {"type":"done"}\n\n', { headers: { 'Content-Type': 'text/event-stream', 'Retry-After': '5' } }))
  vi.stubGlobal('fetch', upstream)
  const result = await onRequestPost({ request, env })
  expect(result.headers.get('Content-Type')).toBe('text/event-stream')
  expect(result.headers.get('Cache-Control')).toBe('no-store, no-transform')
  expect(result.headers.get('Retry-After')).toBe('5')
  expect(upstream.mock.calls[0][0]).toBe('https://control.test/generate')
  expect(upstream.mock.calls[0][1].headers['X-Demo-Key']).toBe(env.DEMO_KEY)
  controller.abort()
  expect(upstream.mock.calls[0][1].signal.aborted).toBe(true)
})
it('enforces the byte limit for multibyte prompts', async () => {
  const request = new Request('https://site.test/api/generate', { method: 'POST', body: '한'.repeat(3000) })
  expect((await onRequestPost({ request, env })).status).toBe(413)
})

it('forwards only the public engine-capacity rejection header', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('engine rejected request', { status: 503, headers: { 'X-Relay-Rejection': 'engine_capacity', 'Retry-After': '2' } })))
  const result = await onRequestPost({ request: new Request('http://local/api/generate', { method: 'POST', body: '{}' }), env: { ORIGIN_URL: 'http://engine', DEMO_KEY: 'server-key' } })
  expect(result.headers.get('X-Relay-Rejection')).toBe('engine_capacity')
  expect(result.headers.get('Retry-After')).toBe('2')
})
