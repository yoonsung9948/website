import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MetricsView, { metricGroups } from './MetricsView'
it('displays every measurement accepted by the live metric decoder exactly once', () => {
  const fields = metricGroups.flatMap(group => group.metrics.map(metric => metric.field))
  expect(fields.sort()).toEqual(['ttftMs', 'decodeTokensPerSecond', 'outputTokens', 'totalLatencyMs', 'inputTokens', 'prefillMs', 'initialQueueMs', 'decodeDurationMs', 'decodeSteps', 'decodeBatchSizeMax', 'decodeBatchSizeMean'].sort())
  expect(new Set(fields).size).toBe(11)
  const html = renderToStaticMarkup(<MetricsView metrics={{}}/>)
  expect((html.match(/<strong>—<\/strong>/g) ?? []).length).toBe(11)
})
it('preserves measured zero values and explains overlapping timing boundaries', () => {
  const html = renderToStaticMarkup(<MetricsView metrics={{ inputTokens: 12, outputTokens: 0, initialQueueMs: 0, prefillMs: 1.5, decodeSteps: 0 }}/>)
  expect((html.match(/<strong>0<\/strong>/g) ?? []).length).toBe(3)
  expect(html).toContain('should not be added')
  expect(html).toContain('Excludes Go, edge, and browser transit')
  expect(html).toContain('Mean decode batch')
})
