import { expect, it } from 'vitest'
import { batchingJobs, cacheComparisonJobs, executeExperiment, type ExperimentResult } from './experiments'
import { sanitizeEngineInfo } from './engine-info'
import { rawEngineInfo } from './engine-info.fixture'
import type { GenerationEvent, GenerationRequest } from './client'
const request = { prompt: 'hello', model: 'configured', maxTokens: 32, temperature: 0.8 }
const info = () => sanitizeEngineInfo(rawEngineInfo())
it('compares only supported modes sequentially with identical greedy settings', async () => {
  const jobs = cacheComparisonJobs(request, info())
  let running = 0, peak = 0
  const calls: GenerationRequest[] = []
  async function* run(req: GenerationRequest): AsyncGenerator<GenerationEvent> {
    running++; peak = Math.max(peak, running); calls.push(req)
    await Promise.resolve()
    yield { type: 'delta', text: 'hello' }
    running--
  }
  const results = await executeExperiment(jobs, info(), false, new AbortController().signal, () => {}, run)
  expect(peak).toBe(1)
  expect(calls.map(call => call.kvCacheMode)).toEqual(['none', 'dynamic', 'pool'])
  expect(calls.every(call => call.temperature === 0 && call.decodeBatching === false && call.maxTokens === 32)).toBe(true)
  expect(results.every(result => result.status === 'complete' && result.output === 'hello')).toBe(true)
})
it('submits a bounded concurrent group and retains a frozen hardware snapshot', async () => {
  const hardware = info(), jobs = batchingJobs(request, hardware, 2)
  expect(() => batchingJobs(request, hardware, 5)).toThrow('capacity')
  let running = 0, peak = 0
  async function* run(): AsyncGenerator<GenerationEvent> {
    running++; peak = Math.max(peak, running); await Promise.resolve(); running--
    yield { type: 'completion', requestId: 'id', finishReason: 'length' }
  }
  const pending = executeExperiment(jobs, hardware, true, new AbortController().signal, () => {}, run)
  hardware.hardware.gpuName = 'changed'
  const results = await pending
  expect(peak).toBe(2)
  expect(results.every(result => result.hardware?.hardware.gpuName === 'RTX A5000')).toBe(true)
})
it('never retries failed requests and skips remaining sequential comparisons', async () => {
  let calls = 0
  async function* run(): AsyncGenerator<GenerationEvent> { calls++; throw new Error('rate limited'); yield { type: 'delta', text: '' } }
  const result = await executeExperiment(cacheComparisonJobs(request, info()), info(), false, new AbortController().signal, () => {}, run)
  expect(calls).toBe(1)
  expect(result.map(row => row.status)).toEqual(['error', 'skipped', 'skipped'])
})
it('propagates shared cancellation to every active request', async () => {
  const controller = new AbortController()
  let calls = 0
  async function* run(_req: GenerationRequest, signal: AbortSignal): AsyncGenerator<GenerationEvent> {
    calls++
    if (calls === 2) controller.abort()
    await Promise.resolve()
    signal.throwIfAborted()
    yield { type: 'delta', text: '' }
  }
  let last: ExperimentResult[] = []
  await executeExperiment(batchingJobs(request, info(), 2), info(), true, controller.signal, rows => { last = rows }, run)
  expect(calls).toBe(2)
  expect(last.every(row => row.status === 'stopped')).toBe(true)
})
