import { useEffect, useRef, useState } from 'react'
import type { GenerationRequest } from './lib/client'
import type { EngineSnapshot } from './lib/use-engine-info'
import { batchingDemoLimit } from './lib/engine-info'
import { batchingJobs, cacheComparisonJobs, executeExperiment, type ExperimentResult } from './lib/experiments'
import RequestDetails from './RequestDetails'
export default function Experiments({ snapshot, request, disabled, onBegin, onEnd }: {
  snapshot: EngineSnapshot | null; request: GenerationRequest; disabled: boolean
  onBegin: (controller: AbortController) => boolean; onEnd: (controller: AbortController) => void
}) {
  const [results, setResults] = useState<ExperimentResult[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [count, setCount] = useState(2)
  const [kind, setKind] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  const limit = snapshot ? batchingDemoLimit(snapshot.info) : 0
  useEffect(() => { if (limit >= 2 && count > limit) setCount(limit) }, [limit, count])
  async function run(kind: 'cache' | 'batch') {
    if (disabled || running || active.current || !snapshot || snapshot.stale || !request.prompt.trim()) return
    const controller = new AbortController()
    if (!onBegin(controller)) return
    active.current = controller
    setRunning(true); setError(''); setKind(kind)
    // A fixed upper bound for the entire demonstration, including sequential runs.
    const timeout = window.setTimeout(() => controller.abort(new Error('Experiment time budget reached.')), 300_000)
    try {
      const info = structuredClone(snapshot.info)
      const jobs = kind === 'cache' ? cacheComparisonJobs(request, info) : batchingJobs(request, info, count)
      await executeExperiment(jobs, info, kind === 'batch', controller.signal, setResults)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to run experiment.') }
    finally { clearTimeout(timeout); active.current = null; setRunning(false); onEnd(controller) }
  }
  const completed = results.filter(result => result.status === 'complete')
  const batchObserved = completed.some(result => (result.metrics?.decodeBatchSizeMax ?? 0) > 1)
  const identities = new Set(completed.map(result => result.generation?.engine_source_sha256).filter(Boolean))
  const executionMismatch = completed.some(result => result.generation?.kv_cache_mode !== result.requested.kvCacheMode || result.generation?.decode_batching !== result.requested.decodeBatching)
  return <details className="demo-experiments"><summary>Experiments · compare cache modes and observe batching</summary>
    <p className="measurement-note">Uses the current prompt and output budget with greedy sampling. Each result is one live observation, not a controlled benchmark. Requests are never automatically retried.</p>
    <div className="experiment-actions">
      <button type="button" disabled={disabled || running || !snapshot || snapshot.stale || snapshot.info.cacheModes.length < 2 || !request.prompt.trim()} onClick={() => void run('cache')}>Compare cache modes</button>
      <label>Concurrent requests <select value={count} disabled={disabled || running || limit < 2} onChange={event => setCount(Number(event.target.value))}>{limit < 2 && <option value={2}>Unavailable</option>}{[2, 3, 4].filter(n => n <= limit).map(n => <option key={n}>{n}</option>)}</select></label>
      <button type="button" disabled={disabled || running || !snapshot || snapshot.stale || limit < count || !request.prompt.trim()} onClick={() => void run('batch')}>Demonstrate batching</button>
      {running && <button type="button" onClick={() => active.current?.abort()}>Stop all</button>}
    </div>
    {limit < 2 && <p className="measurement-note">Batching requires pooled cache, at least two worker slots, and matching Go admission capacity.</p>}
    <p className="measurement-note">Cache comparisons run sequentially without batching; the first run may include warmup effects. The batching demo sends a bounded concurrent group; shared traffic or rate limits may reject it. Admission snapshots do not reserve capacity.</p>
    {error && <p role="alert">{error}</p>}
    <p role="status">{running ? 'Experiment in progress…' : results.length ? 'Experiment finished.' : ''}</p>
    {identities.size > 1 && <p role="alert">The reported engine changed between requests; these results are not directly comparable.</p>}
    {executionMismatch && <p role="alert">Execution settings were missing or differed from the request. Refresh the deployed engine before comparing modes.</p>}
    {kind === 'batch' && completed.length > 0 && !running && <p className="measurement-note">{batchObserved ? 'The engine reported a decode batch larger than one.' : 'No multi-request decode batch was observed. Enabling batching does not guarantee requests overlap.'}</p>}
    <div className="experiment-results">{results.map((result, i) => <article key={i} className="experiment-result">
      <h4>{result.label} · {result.status}</h4><pre>{result.output || 'No output yet.'}</pre>
      {result.error && <p role="alert">{result.error}</p>}
      <RequestDetails record={result}/>
    </article>)}</div>
  </details>
}
