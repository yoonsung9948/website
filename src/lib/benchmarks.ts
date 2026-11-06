export type Timing = { samples: number; p50_ms: number | null; p95_ms: number | null }
export type SavedRun = {
  schema_version: 1
  metadata: Record<string, unknown>
  summary: {
    run_id: string; status: string; elapsed_seconds: number; started: number; successful: number
    failed: number; skipped: number; cancelled: number; token_count_samples: number
    load_mode?: string
    configured_concurrency?: number | null
    max_observed_in_flight?: number | null
    requested_requests?: number | null
    rejected?: number
    offered_requests_per_second?: number | null
    successful_requests_per_second: number | null; output_tokens_per_second: number | null
    latency: Timing; first_text_latency: Timing | null; engine_ttft: Timing | null
  }
  reportUrl?: string
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function timing(value: unknown): boolean {
  return object(value) && nonnegative(value.samples) && Number.isInteger(value.samples)
    && ['p50_ms', 'p95_ms'].every(key => value[key] === null || nonnegative(value[key]))
}

export function parseSavedRun(value: unknown): SavedRun {
  if (!object(value) || value.schema_version !== 1 || !object(value.metadata) || !object(value.summary)) throw new Error('Expected a version 1 loadgen summary.json.')
  const s = value.summary
  if (typeof s.run_id !== 'string' || !s.run_id || !['completed', 'cancelled', 'failed'].includes(String(s.status))) throw new Error('Invalid run identity or status.')
  for (const key of ['elapsed_seconds', 'started', 'successful', 'failed', 'skipped', 'cancelled', 'token_count_samples']) {
    if (!nonnegative(s[key]) || (key !== 'elapsed_seconds' && !Number.isInteger(s[key]))) throw new Error(`Invalid ${key}.`)
  }
  for (const key of ['successful_requests_per_second', 'output_tokens_per_second']) {
    if (s[key] !== null && !nonnegative(s[key])) throw new Error(`Invalid ${key}.`)
  }
  if (s.rejected !== undefined && (!nonnegative(s.rejected) || !Number.isInteger(s.rejected))) throw new Error('Invalid rejection count.')
  if (s.offered_requests_per_second !== undefined && s.offered_requests_per_second !== null && !nonnegative(s.offered_requests_per_second)) throw new Error('Invalid offered request rate.')
  if (s.load_mode !== undefined && !['open_loop', 'closed_loop'].includes(String(s.load_mode))) throw new Error('Invalid load mode.')
  for (const key of ['configured_concurrency', 'max_observed_in_flight', 'requested_requests']) {
    if (s[key] !== undefined && s[key] !== null && (!nonnegative(s[key]) || !Number.isInteger(s[key]) || (key !== 'max_observed_in_flight' && s[key] === 0))) throw new Error(`Invalid ${key}.`)
  }
  if (s.load_mode === 'closed_loop' && !nonnegative(s.configured_concurrency)) throw new Error('Closed-loop concurrency is missing.')
  if (!timing(s.latency) || !['first_text_latency', 'engine_ttft'].every(key => s[key] === null || timing(s[key]))) throw new Error('Invalid timing summary.')
  return value as unknown as SavedRun
}

export function comparisonWarnings(runs: SavedRun[]): string[] {
  function differences(a: unknown, b: unknown, path = ''): string[] {
    if (object(a) && object(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key => differences(a[key], b[key], path ? `${path}.${key}` : key))
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((value, i) => differences(value, b[i], `${path}[${i}]`))
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [path || 'value']
  }
  if (!runs.length) return []
  return ['effective_generation', 'declared', 'scenario', 'benchmark', 'hardware', 'identity', 'instrumentation'].flatMap(key => {
    const paths = [...new Set(runs.slice(1).flatMap(run => differences(runs[0].metadata[key], run.metadata[key])))].sort()
    return paths.length ? [`${key.replaceAll('_', ' ')} differs: ${paths.join(', ')}. Verify these are intended experiment variables.`] : []
  })
}

export function offeredRate(run: SavedRun): number | undefined {
  const rate = run.summary.offered_requests_per_second
  return nonnegative(rate) ? rate : undefined
}

export type CacheMode = 'kv' | 'no-kv' | 'dynamic' | 'pool' | 'pool-batched' | 'unknown'
export const cacheColors: Record<CacheMode, string> = { kv: '#0369a1', 'no-kv': '#b45309', dynamic: '#0369a1', pool: '#7c3aed', 'pool-batched': '#047857', unknown: '#596052' }
export const cacheLabels: Record<CacheMode, string> = { kv: 'KV cache (legacy)', 'no-kv': 'No KV cache', dynamic: 'Dynamic KV cache', pool: 'Pooled KV cache', 'pool-batched': 'Pooled KV + decode batching', unknown: 'Cache mode unreported / mixed' }

export function cacheMode(run: SavedRun): CacheMode {
  const generation = run.metadata.effective_generation
  if (!Array.isArray(generation) || !generation.length) return 'unknown'
  const values = generation.map((value): CacheMode => {
    if (!object(value)) return 'unknown'
    if (value.kv_cache_mode === 'none') return 'no-kv'
    if (value.kv_cache_mode === 'dynamic') return 'dynamic'
    if (value.kv_cache_mode === 'pool') return value.decode_batching === true ? 'pool-batched' : value.decode_batching === false ? 'pool' : 'unknown'
    if (value.kv_cache_mode !== undefined) return 'unknown'
    return value.use_kv_cache === true ? 'kv' : value.use_kv_cache === false ? 'no-kv' : 'unknown'
  })
  return values.every(value => value === values[0]) ? values[0] : 'unknown' 
}

export function concurrency(run: SavedRun): number | undefined {
  const s = run.summary
  return s.load_mode === 'closed_loop' && nonnegative(s.configured_concurrency) && Number.isInteger(s.configured_concurrency) && s.configured_concurrency > 0 ? s.configured_concurrency : undefined
}

export function compareRuns(a: SavedRun, b: SavedRun): number {
  return (concurrency(a) ?? Infinity) - (concurrency(b) ?? Infinity) || cacheMode(a).localeCompare(cacheMode(b)) || a.summary.run_id.localeCompare(b.summary.run_id)
}
