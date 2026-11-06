import type { Metrics } from './lib/client'
type MetricDefinition = { field: keyof Metrics; label: string; unit: string; description: string }
export const metricGroups: { title: string; description: string; metrics: MetricDefinition[] }[] = [
  { title: 'Token counts', description: 'Actual tokenizer counts reported by the worker.', metrics: [
    { field: 'inputTokens', label: 'Input tokens', unit: 'tokens', description: 'Tokenized input, including the model chat template.' },
    { field: 'outputTokens', label: 'Output tokens', unit: 'tokens', description: 'Generated model tokens; text chunks are not token counts.' },
  ] },
  { title: 'Latency breakdown', description: 'Python process timings. These intervals overlap and should not be added together.', metrics: [
    { field: 'ttftMs', label: 'Time to first token', unit: 'ms', description: 'Python handler start to the first generated token, before text buffering.' },
    { field: 'initialQueueMs', label: 'Initial queue wait', unit: 'ms', description: 'Enqueue to first scheduling; excludes later scheduling waits.' },
    { field: 'prefillMs', label: 'Prefill duration', unit: 'ms', description: 'Engine-reported prompt processing duration; not an isolated CUDA kernel measurement.' },
    { field: 'decodeDurationMs', label: 'Decode duration', unit: 'ms', description: 'First-to-last generated-token interval; unavailable when insufficient tokens were generated.' },
    { field: 'totalLatencyMs', label: 'Total engine latency', unit: 'ms', description: 'Python handler start to finalized output. Excludes Go, edge, and browser transit.' },
  ] },
  { title: 'Decode and batching', description: 'Observed execution, rather than the requested batching setting.', metrics: [
    { field: 'decodeTokensPerSecond', label: 'Decode throughput', unit: 'tok/s', description: 'Tokens after the first divided by first-to-last token time, including scheduling waits.' },
    { field: 'decodeSteps', label: 'Decode steps', unit: 'steps', description: 'Recorded decode-step count reported by the engine.' },
    { field: 'decodeBatchSizeMean', label: 'Mean decode batch', unit: 'requests', description: 'Mean observed decode batch size for this request’s recorded steps.' },
    { field: 'decodeBatchSizeMax', label: 'Maximum decode batch', unit: 'requests', description: 'Largest observed decode batch. Enabling batching does not guarantee a value above one.' },
  ] },
]
export default function MetricsView({ metrics }: { metrics: Metrics }) {
  return <div className="metrics-dashboard" aria-label="All inference metrics">
    <div className="metrics-intro"><h3>Latest playground request metrics</h3><p>Python engine · metric schema v1. Measurements populate at completion. — means unavailable; zero is a measured value. Experiment trials keep their own measurements below.</p></div>
    {metricGroups.map(group => <section className="metric-group" key={group.title} aria-label={group.title}>
      <div className="metric-group-heading"><h4>{group.title}</h4><p>{group.description}</p></div>
      <div className="metrics">{group.metrics.map(metric => <div className="metric" key={metric.field} title={metric.description}>
        <span>{metric.label}</span><div><strong>{metrics[metric.field] === undefined ? '—' : metrics[metric.field]!.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><small>{metric.unit}</small></div>
        <p className="metric-explanation">{metric.description}</p>
      </div>)}</div>
    </section>)}
  </div>
}
