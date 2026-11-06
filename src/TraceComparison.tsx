import { useEffect, useId, useState } from 'react'
import { cacheColors, cacheLabels } from './lib/benchmarks'
import { parseTraceWindows, type TraceStep, type TraceWindow } from './lib/trace-comparison'

type Selection = { window: TraceWindow; step: TraceStep }
type Hover = Selection & { x: number; y: number }
const ms = (value: number) => `${value.toFixed(2)} ms`
const key = (s: Selection) => `${s.window.run_id}:${s.step.request_id}:${s.step.step_index}`

function StepDetails({ selection }: { selection: Selection }) {
  return <><strong>{cacheLabels[selection.window.mode]} · request {selection.step.request_id} · step {selection.step.step_index}</strong>
    <dl><div><dt>Duration</dt><dd>{ms(selection.step.duration_ms)}</dd></div><div><dt>Input tokens</dt><dd>{selection.step.input_tokens}</dd></div><div><dt>Scheduler wait</dt><dd>{ms(selection.step.scheduler_wait_ms)}</dd></div></dl>
    {(selection.step.start_ms < 0 || selection.step.end_ms > selection.window.duration_ms) && <small>Bar clipped at window edge; duration is for the full span.</small>}</>
}

export default function TraceComparison() {
  const [windows, setWindows] = useState<TraceWindow[]>([])
  const [error, setError] = useState('')
  const [hover, setHover] = useState<Hover | null>(null)
  const [pinned, setPinned] = useState<Selection | null>(null)
  const id = useId()
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}blog/kv-cache-baseline/snapshot.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Unable to load saved trace data.'); return response.json() })
      .then(data => { if (!controller.signal.aborted) setWindows(parseTraceWindows(data)) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load traces.') })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const clear = () => setHover(null)
    window.addEventListener('scroll', clear, true)
    return () => window.removeEventListener('scroll', clear, true)
  }, [])
  function inspect(selection: Selection, x: number, y: number) {
    setHover({ ...selection, x: Math.max(12, Math.min(x + 12, window.innerWidth - 292)), y: Math.max(12, Math.min(y + 12, window.innerHeight - 190)) })
  }
  const current = hover ?? pinned
  return <section className="trace-comparison" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Inspect the cached and uncached steps</h3>
    <p id={`${id}-help`}>Hover or focus a step for its measurements. Click, tap, or press Enter to pin it; Escape clears the selection. Orange squares: no KV. Blue rounded bars: KV.</p>
    <div className="trace-details" role="status" aria-live="polite" aria-atomic="true">
      {current ? <StepDetails selection={current}/> : <p>Select a step to inspect its duration, input tokens, and scheduler wait.</p>}
      {pinned && <button type="button" onClick={() => { setPinned(null); setHover(null) }}>Clear pinned step</button>}
    </div>
    {error ? <p role="alert">{error} <a href={`${import.meta.env.BASE_URL}blog/kv-cache-baseline/trace-comparison.svg`}>Open the static trace comparison.</a></p> : !windows.length ? <p role="status">Loading saved trace windows…</p> : windows.map(window => {
      const left = 115, right = 875, rowHeight = 48, top = 26, bottom = top + window.request_ids.length * rowHeight
      const x = (time: number) => left + time / window.duration_ms * (right - left)
      return <div className="trace-panel" key={window.mode}>
        <h4 style={{ color: cacheColors[window.mode] }}>{cacheLabels[window.mode]}</h4>
        <div className="trace-scroll" role="region" aria-label={`${cacheLabels[window.mode]} trace lanes; scroll horizontally on a small screen`} tabIndex={0}>
          <svg viewBox={`0 0 900 ${bottom + 55}`} role="group" aria-label={`${cacheLabels[window.mode]}: four requests, ${window.duration_ms} ms window`}>
            {Array.from({ length: 7 }, (_, i) => i * window.duration_ms / 6).map(t => <g key={t}><path d={`M${x(t)} ${top - 10}V${bottom}`} stroke="#d8ddd1"/><text x={x(t)} y={bottom + 22} textAnchor="middle">{t.toFixed(0)}</text></g>)}
            {window.request_ids.map((request, lane) => {
              const y = top + lane * rowHeight
              return <g key={request}><text x={left - 12} y={y + 21} textAnchor="end">Request {request}</text><rect x={left} y={y} width={right - left} height="32" fill="#edf0e8"/>
                {window.spans.filter(s => s.request_id === request).map(step => {
                  const selection = { window, step }, active = current && key(current) === key(selection)
                  const start = Math.max(0, step.start_ms), end = Math.min(window.duration_ms, step.end_ms), width = x(end) - x(start)
                  return <g key={step.step_index}>
                    <rect x={x(start)} y={y} width={width} height="32" rx={window.mode === 'kv' ? 5 : 0}
                      className={`trace-step${active ? ' is-active' : ''}`} fill={cacheColors[window.mode]} tabIndex={0} role="button" aria-pressed={pinned ? key(pinned) === key(selection) : false}
                      aria-label={`${cacheLabels[window.mode]}, request ${request}, step ${step.step_index}: duration ${ms(step.duration_ms)}, ${step.input_tokens} input tokens, scheduler wait ${ms(step.scheduler_wait_ms)}`}
                      aria-describedby={`${id}-help`}
                      onPointerEnter={event => inspect(selection, event.clientX, event.clientY)} onPointerLeave={() => setHover(null)}
                      onFocus={event => { const rect = event.currentTarget.getBoundingClientRect(); inspect(selection, rect.left, rect.bottom) }} onBlur={() => setHover(null)}
                      onClick={() => setPinned(previous => previous && key(previous) === key(selection) ? null : selection)}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPinned(selection) } else if (event.key === 'Escape') { setPinned(null); setHover(null) } }}/>
                    {width > 28 && <text className="trace-step-label" x={x(start) + width / 2} y={y + 21} textAnchor="middle">s{step.step_index}</text>}
                  </g>
                })}
              </g>
            })}
            <text x="500" y={bottom + 46} textAnchor="middle">Milliseconds since this run’s reference step</text>
          </svg>
        </div>
      </div>
    })}
    <p className="trace-caption">Actual concurrency-4 excerpts, independently aligned at request 8, step 40. Both panels use the same 600 ms scale. Other requests are at different steps across runs. Gaps are outside that request’s runner span, not necessarily idle GPU time.</p>
    {hover && <div className="trace-tooltip" aria-hidden="true" style={{ left: hover.x, top: hover.y }}><StepDetails selection={hover}/></div>}
  </section>
}
