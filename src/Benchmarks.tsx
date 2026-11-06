import { useEffect, useState } from 'react'
import { findPost } from './lib/blog'
import { comparisonWarnings, parseSavedRun, offeredRate, type SavedRun, cacheMode, cacheColors, cacheLabels, concurrency, compareRuns } from './lib/benchmarks'

const format = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
function ComparisonPlot({ runs, axis, metric }: { runs: SavedRun[]; axis: 'concurrency' | 'rps'; metric: 'tokens' | 'requests' | 'latency' }) {
  const name = metric === 'tokens' ? 'Output throughput' : metric === 'requests' ? 'Completed throughput' : 'Client completion p50'
  const unit = metric === 'tokens' ? 'tok/s' : metric === 'requests' ? 'req/s' : 'ms'
  const points = runs.flatMap(run => {
    const x = axis === 'concurrency' ? concurrency(run) : offeredRate(run)
    const y = metric === 'tokens' ? run.summary.output_tokens_per_second : metric === 'requests' ? run.summary.successful_requests_per_second : run.summary.latency.p50_ms
    return x === undefined || y === null ? [] : [{ x, y, run, mode: cacheMode(run) }]
  })
  if (!points.length) return null
  const xmax = Math.max(1, ...points.map(p => p.x))
  const ymax = (Math.max(...points.map(p => p.y)) || 1) * 1.1
  const ticks = [...new Set(points.map(p => p.x))].sort((a, b) => a - b)
  return <section className="benchmark-chart"><h3>{name} vs {axis === 'concurrency' ? 'concurrency' : 'offered RPS'}</h3>
    <svg viewBox="0 0 560 270" role="img" aria-label={`${name} by ${axis}. Squares: no KV; colored circles distinguish cache and batching modes.`}>
      {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}>
        <path d={`M65 ${205 - fraction * 160}H530`} stroke="#d9ddd3"/>
        <text x="55" y={210 - fraction * 160} textAnchor="end">{format(ymax * fraction)}</text>
      </g>)}
      <text x="65" y="24">{unit}</text>
      {ticks.map(x => <text key={x} x={65 + x / xmax * 450} y="228" textAnchor="middle">{format(x)}</text>)}
      <text x="290" y="255" textAnchor="middle">{axis === 'concurrency' ? 'Configured outstanding requests' : 'Planned arrivals / load-window second'}</text>
      {points.map(p => {
        const x = 65 + p.x / xmax * 450, y = 205 - p.y / ymax * 160
        const title = `${cacheLabels[p.mode]} · ${p.run.summary.run_id}: ${p.x}, ${format(p.y)} ${unit}`
        return p.mode === 'no-kv' ? <rect key={p.run.summary.run_id} x={x - 5} y={y - 5} width="10" height="10" fill={cacheColors[p.mode]}><title>{title}</title></rect> : <circle key={p.run.summary.run_id} cx={x} cy={y} r="5" fill={cacheColors[p.mode]}><title>{title}</title></circle>
      })}
    </svg><p>Each marker is one saved trial. Compare matching workloads and sample counts; no percentile pooling.</p>
  </section>
}

export default function Benchmarks() {
  const [runs, setRuns] = useState<SavedRun[]>([])
  const [error, setError] = useState('')
  const merge = (incoming: SavedRun[]) => setRuns(old => [...new Map([...old, ...incoming].map(run => [run.summary.run_id, run])).values()].sort(compareRuns))
  useEffect(() => {
    const controller = new AbortController()
    const base = `${import.meta.env.BASE_URL}benchmarks/`
    void (async () => {
      try {
        const response = await fetch(`${base}index.json`, { signal: controller.signal })
        if (!response.ok) throw new Error('Unable to load published benchmark results.')
        const entries: unknown = await response.json()
        if (!Array.isArray(entries)) throw new Error('Invalid benchmark index.')
        const incoming = await Promise.all(entries.map(async entry => {
          if (!entry || !/^[\w-]+\/summary\.json$/.test(entry.summary) || (entry.report !== undefined && !/^[\w-]+\/report\.html$/.test(entry.report))) throw new Error('Invalid saved-result path.')
          const response = await fetch(`${base}${entry.summary}`, { signal: controller.signal })
          if (!response.ok) throw new Error('Unable to load a published run.')
          return { ...parseSavedRun(await response.json()), reportUrl: entry.report ? `${base}${entry.report}` : undefined }
        }))
        if (!controller.signal.aborted) merge(incoming)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load results.')
      }
    })()
    return () => controller.abort()
  }, [])

  async function importFiles(files: FileList | null) {
    if (!files) return
    setError('')
    try { merge(await Promise.all(Array.from(files).map(async file => parseSavedRun(JSON.parse(await file.text()))))) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read results.') }
  }

  return <>
    <div className="intro"><p className="eyebrow">REPRODUCIBLE EXPERIMENTS</p><h1 id="benchmarks-heading" tabIndex={-1}>Benchmarks<span className="period">.</span></h1><p className="intro-description">Saved load tests, with the workload and measurement boundaries attached.</p></div>
    <section className="mac-window benchmark-viewer">
      <div className="window-title"><h2>inference — results</h2></div>
      <div className="benchmark-content">
        <label className="benchmark-import">Compare saved runs <input type="file" accept="application/json,.json" multiple onChange={event => void importFiles(event.target.files)}/></label>
        {findPost('kv-cache-baseline') && <p><a href="#blog/kv-cache-baseline">Read the benchmark analysis ↗</a></p>}<p className="measurement-note">Open one or more loadgen summary.json files. Local files stay in this browser.</p>
        {error && <p role="alert">{error}</p>}
        {!runs.length && <p>No benchmark runs have been published yet. The playground’s cards describe a single live request; this page compares saved experiments.</p>}
        {comparisonWarnings(runs).map(warning => <p className="benchmark-warning" key={warning}>{warning}</p>)}
        {!!runs.length && <>
          <div className="benchmark-table"><table><thead><tr><th>Cache / run / status</th><th>Workload / concurrency</th><th>Success / started</th><th>Failed / skipped / cancelled</th><th>req/s</th><th>Counted tok/s</th><th>Token coverage</th><th>First text p50</th><th>Completion p50 / p95</th><th>Engine TTFT p50</th></tr></thead>
            <tbody>{runs.map(run => <tr key={run.summary.run_id}><td><span style={{ color: cacheColors[cacheMode(run)] }}>{cacheMode(run) === 'no-kv' ? '■' : '●'}</span> {cacheLabels[cacheMode(run)]}<small>{run.summary.run_id.slice(0, 8)}</small><small>{run.summary.status}</small></td><td>{concurrency(run) !== undefined ? `Concurrency ${concurrency(run)}` : `Offered ${format(offeredRate(run))} RPS`}<small>{run.summary.load_mode ?? 'open_loop'}{run.summary.max_observed_in_flight != null ? ` · peak ${run.summary.max_observed_in_flight}` : ''}</small></td><td>{run.summary.successful} / {run.summary.started}</td><td>{run.summary.failed} / {run.summary.skipped} / {run.summary.cancelled}<small>{format(run.summary.rejected)} reported rejections</small></td><td>{format(run.summary.successful_requests_per_second)}</td><td>{format(run.summary.output_tokens_per_second)}</td><td>{run.summary.token_count_samples} / {run.summary.successful}</td><td>{format(run.summary.first_text_latency?.p50_ms)} ms</td><td>{format(run.summary.latency.p50_ms)} / {format(run.summary.latency.p95_ms)} ms</td><td>{format(run.summary.engine_ttft?.p50_ms)} ms</td></tr>)}</tbody></table></div>
          <p className="measurement-note">Throughput includes drain time. Missing token counts remain unavailable. Tail estimates need sufficient samples.</p>
          <p className="benchmark-legend">{Object.entries(cacheLabels).map(([mode, label]) => <span key={mode} style={{ color: cacheColors[mode as keyof typeof cacheColors] }}>{mode === 'no-kv' ? '■' : '●'} {label}</span>)}</p>
          <div className="benchmark-charts">{(['concurrency', 'rps'] as const).flatMap(axis => (['tokens', 'requests', 'latency'] as const).map(metric => <ComparisonPlot key={`${axis}-${metric}`} runs={runs} axis={axis} metric={metric}/>))}</div>
          {runs.map(run => <details key={run.summary.run_id}><summary>Run context · {run.summary.run_id.slice(0, 8)}</summary>{run.reportUrl && <p><a href={run.reportUrl} target="_blank" rel="noopener noreferrer">Open full report ↗</a></p>}<pre>{JSON.stringify(run.metadata, null, 2)}</pre></details>)}
        </>}
      </div>
    </section>
  </>
}
