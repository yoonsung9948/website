export type TraceStep = {
  request_id: string; step_index: number; input_tokens: number; scheduler_wait_ms: number
  start_ms: number; end_ms: number; duration_ms: number
}
export type TraceWindow = {
  mode: 'no-kv' | 'kv'; run_id: string; request_ids: string[]
  reference_request_id: string; reference_step_index: number; duration_ms: number; spans: TraceStep[]
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0

export function parseTraceWindows(value: unknown): TraceWindow[] {
  if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.trace_windows) || value.trace_windows.length !== 2) throw new Error('Expected two saved trace windows.')
  const windows = value.trace_windows.map(window => {
    if (!object(window) || !['no-kv', 'kv'].includes(String(window.mode)) || typeof window.run_id !== 'string' || !Array.isArray(window.request_ids) || !window.request_ids.length || !window.request_ids.every(id => typeof id === 'string') || new Set(window.request_ids).size !== window.request_ids.length || typeof window.reference_request_id !== 'string' || !window.request_ids.includes(window.reference_request_id) || !count(window.reference_step_index) || !finite(window.duration_ms) || window.duration_ms <= 0 || !Array.isArray(window.spans) || !window.spans.length) throw new Error('Invalid trace window.')
    const keys = new Set<string>()
    for (const span of window.spans) {
      if (!object(span) || typeof span.request_id !== 'string' || !window.request_ids.includes(span.request_id) || !count(span.step_index) || (!count(span.input_tokens) || span.input_tokens < 1) || !finite(span.scheduler_wait_ms) || span.scheduler_wait_ms < 0 || !finite(span.start_ms) || !finite(span.end_ms) || !finite(span.duration_ms) || span.duration_ms <= 0 || span.end_ms <= span.start_ms || span.end_ms <= 0 || span.start_ms >= window.duration_ms || Math.abs(span.end_ms - span.start_ms - span.duration_ms) > .001) throw new Error('Invalid runner step.')
      const key = `${span.request_id}:${span.step_index}`
      if (keys.has(key)) throw new Error('Duplicate runner step.')
      keys.add(key)
    }
    return window as unknown as TraceWindow
  })
  if (new Set(windows.map(w => w.mode)).size !== 2 || windows[0].duration_ms !== windows[1].duration_ms) throw new Error('Trace windows must use distinct cache modes and equal time scales.')
  return windows.sort((a, b) => a.mode === b.mode ? 0 : a.mode === 'no-kv' ? -1 : 1)
}

export const TRACE_EMBED = '\n\n:::kv-trace-comparison:::\n\n'
export function splitTraceArticle(body: string): string[] { return body.split(TRACE_EMBED) }
