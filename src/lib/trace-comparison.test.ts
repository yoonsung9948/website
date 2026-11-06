import { expect, it } from 'vitest'
import snapshot from '../../public/blog/kv-cache-baseline/snapshot.json'
import { parseTraceWindows, splitTraceArticle, TRACE_EMBED } from './trace-comparison'
import { renderMarkdown } from './blog'

it('loads real saved spans without losing negative offsets or clipped durations', () => {
  const windows = parseTraceWindows(snapshot)
  expect(windows.map(w => w.mode)).toEqual(['no-kv', 'kv'])
  expect(windows.every(w => w.duration_ms === 600 && w.request_ids.length === 4)).toBe(true)
  for (const window of windows) {
    expect(window.spans.some(s => s.end_ms > 600)).toBe(true)
    expect(window.spans.every(s => Math.abs(s.duration_ms - (s.end_ms - s.start_ms)) < .001)).toBe(true)
    expect(window.spans.every(s => window.mode === 'kv' ? s.input_tokens === 1 : s.input_tokens === 24 + s.step_index)).toBe(true)
  }
})
it('rejects invalid timing, modes, and duplicate steps', () => {
  for (const patch of [{ duration_ms: -1 }, { input_tokens: '1' }, { scheduler_wait_ms: -2 }, { start_ms: Infinity }]) {
    const data = structuredClone(snapshot)
    Object.assign(data.trace_windows[0].spans[0], patch)
    expect(() => parseTraceWindows(data)).toThrow()
  }
  const duplicate = structuredClone(snapshot)
  duplicate.trace_windows[0].spans.push(duplicate.trace_windows[0].spans[0])
  expect(() => parseTraceWindows(duplicate)).toThrow('Duplicate')
  const mismatch = structuredClone(snapshot)
  mismatch.trace_windows[0].duration_ms = 500
  expect(() => parseTraceWindows(mismatch)).toThrow()
})
it('inserts only the explicit article block and keeps raw HTML escaped', () => {
  expect(splitTraceArticle(`Before${TRACE_EMBED}After`)).toEqual(['Before', 'After'])
  expect(splitTraceArticle('inline :::kv-trace-comparison::: text')).toHaveLength(1)
  expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
})
