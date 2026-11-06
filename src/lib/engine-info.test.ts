import { expect, it } from 'vitest'
import { batchingDemoLimit, parsePublicEngineInfo, sanitizeEngineInfo } from './engine-info'
import { rawEngineInfo } from './engine-info.fixture'
import { onRequestGet } from '../../functions/api/engine/info'
it('allowlists hardware and controls while removing private fields', () => {
  const info = sanitizeEngineInfo(rawEngineInfo())
  expect(info.cacheModes).toEqual(['none', 'dynamic', 'pool'])
  expect(info.maxOutputTokens).toBe(256)
  expect(info.hardware.gpuName).toBe('RTX A5000')
  expect(info.hardware.requestedGPU).toBe('requested type')
  expect(info.hardware.region).toBeNull()
  expect(JSON.stringify(info)).not.toMatch(/hidden|private|HF_TOKEN|demo_key/)
  expect(parsePublicEngineInfo(info)).toEqual(info)
})
it('fails closed on incompatible capabilities and never infers feature support', () => {
  expect(() => sanitizeEngineInfo({})).toThrow('capabilities')
  const raw = rawEngineInfo()
  Object.assign(raw.worker.capabilities, { decode_batching: undefined, temperature_sampling: undefined })
  const info = sanitizeEngineInfo(raw)
  expect(info.decodeBatching).toBe(false)
  expect(info.temperatureSampling).toBe(false)
})
it('bounds batching by Go admission, worker slots, and enabled rate burst', () => {
  const info = sanitizeEngineInfo(rawEngineInfo())
  expect(batchingDemoLimit(info)).toBe(4)
  info.admission.maxConcurrent = 2
  expect(batchingDemoLimit(info)).toBe(2)
  info.admission.burst = 1
  expect(batchingDemoLimit(info)).toBe(1)
  info.admission.limited = false
  expect(batchingDemoLimit(info)).toBe(2)
  info.decodeBatching = false
  expect(batchingDemoLimit(info)).toBe(0)
})
it('proxies authenticated discovery and sanitizes errors as well as successes', async () => {
  const original = globalThis.fetch
  try {
    let calls = 0
    globalThis.fetch = async (_input, init) => {
      expect(init?.headers).toEqual({ 'X-Demo-Key': 'server-only' })
      calls++
      return calls === 1 ? Response.json(rawEngineInfo()) : new Response('private worker URL', { status: 500 })
    }
    const context = { request: new Request('http://local/api/engine/info'), env: { ORIGIN_URL: 'http://worker', DEMO_KEY: 'server-only' } }
    const response = await onRequestGet(context)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(parsePublicEngineInfo(await response.json()).hardware.gpuName).toBe('RTX A5000')
    const failure = await onRequestGet(context)
    expect(failure.status).toBe(503)
    expect(await failure.text()).not.toContain('private')
  } finally { globalThis.fetch = original }
})

it('does not label a CPU device as a confirmed GPU', () => {
  const raw = rawEngineInfo()
  Object.assign(raw.worker.capabilities, { device: 'cpu', hardware: null, identity: { device_name: 'cpu' } })
  expect(sanitizeEngineInfo(raw).hardware.gpuName).toBeNull()
})
