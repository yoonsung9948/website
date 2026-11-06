import { expect, it } from 'vitest'
import { comparisonWarnings, parseSavedRun } from './benchmarks'
const timing = { samples: 2, p50_ms: 0, p95_ms: 12 }
const bundle = { schema_version: 1, metadata: { declared: { hardware: 'test' } }, summary: {
  run_id: 'a', status: 'completed', elapsed_seconds: 2, started: 2, successful: 2, failed: 0, skipped: 0, cancelled: 0,
  token_count_samples: 0, successful_requests_per_second: 1, output_tokens_per_second: null,
  latency: timing, first_text_latency: null, engine_ttft: null,
} }
it('accepts actual zero measurements and unavailable token counts', () => {
  expect(parseSavedRun(bundle).summary.latency.p50_ms).toBe(0)
  expect(parseSavedRun(bundle).summary.output_tokens_per_second).toBeNull()
})
it('rejects invalid schemas and nonfinite summary values', () => {
  expect(() => parseSavedRun({ ...bundle, schema_version: 2 })).toThrow()
  expect(() => parseSavedRun({ ...bundle, summary: { ...bundle.summary, started: Infinity } })).toThrow()
})
it('flags differing experiment context', () => {
  const first = parseSavedRun(bundle)
  const second = parseSavedRun({ ...bundle, metadata: { declared: { hardware: 'other' } } })
  expect(comparisonWarnings([first, second])).toEqual(['declared differs: hardware. Verify these are intended experiment variables.'])
})

import { cacheMode, cacheColors, concurrency, compareRuns } from './benchmarks'
it('identifies cache mode from effective generation, not an experiment name', () => {
  const mode = (values: unknown[]) => cacheMode(parseSavedRun({ ...bundle, metadata: { effective_generation: values } }))
  expect(mode([{ use_kv_cache: false }])).toBe('no-kv')
  expect(mode([{ use_kv_cache: true }])).toBe('kv')
  expect(mode([{ use_kv_cache: true }, { use_kv_cache: false }])).toBe('unknown')
  expect(mode([{}])).toBe('unknown')
  expect(mode([])).toBe('unknown')
  expect(cacheColors.kv).not.toBe(cacheColors['no-kv'])
})
it('recognizes concurrency without inventing an offered RPS and orders matching trials', () => {
  const make = (c: number, cache: boolean) => parseSavedRun({ ...bundle, metadata: { effective_generation: [{ use_kv_cache: cache }] }, summary: { ...bundle.summary, run_id: `${cache}-${c}`, load_mode: 'closed_loop', configured_concurrency: c, offered_requests_per_second: null } })
  const runs = [make(4, false), make(1, false), make(2, true), make(1, true)].sort(compareRuns)
  expect(runs.map(concurrency)).toEqual([1, 1, 2, 4])
  expect(concurrency(parseSavedRun(bundle))).toBeUndefined()
  for (const value of [0, -1, 1.5, Infinity]) expect(() => parseSavedRun({ ...bundle, summary: { ...bundle.summary, load_mode: 'closed_loop', configured_concurrency: value } })).toThrow()
})
it('loads all six article snapshots with complete cache and concurrency context', () => {
  const files = import.meta.glob('../../public/benchmarks/*/summary.json', { eager: true, import: 'default' })
  const runs = Object.values(files).map(parseSavedRun)
  expect(runs).toHaveLength(6)
  expect(runs.filter(run => cacheMode(run) === 'kv')).toHaveLength(3)
  expect(runs.map(concurrency).sort()).toEqual([1, 1, 2, 2, 4, 4])
  expect(runs.every(run => run.summary.successful === 20)).toBe(true)
})

it('distinguishes dynamic cache, pooled cache, and enabled decode batching', () => {
  const run = (generation: unknown[]) => parseSavedRun({ ...bundle, metadata: { effective_generation: generation } })
  expect(cacheMode(run([{ kv_cache_mode: 'dynamic' }]))).toBe('dynamic')
  expect(cacheMode(run([{ kv_cache_mode: 'pool', decode_batching: false }]))).toBe('pool')
  expect(cacheMode(run([{ kv_cache_mode: 'pool', decode_batching: true }]))).toBe('pool-batched')
  expect(cacheMode(run([{ kv_cache_mode: 'pool' }]))).toBe('unknown')
  expect(cacheMode(run([{ kv_cache_mode: 'dynamic' }, { kv_cache_mode: 'none' }]))).toBe('unknown')
})
