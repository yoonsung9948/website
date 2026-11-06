import type { GenerationMetadata, GenerationRequest, Metrics } from './lib/client'
import type { EngineInfo } from './lib/engine-info'
export type RequestRecord = { requested: GenerationRequest; hardware?: EngineInfo; metrics?: Metrics; generation?: GenerationMetadata; requestId?: string; finishReason?: string }
const value = (number?: number, unit = '') => number === undefined ? '—' : `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`
export default function RequestDetails({ record }: { record: RequestRecord }) {
  const m = record.metrics ?? {}, g = record.generation, h = record.hardware
  return <details className="request-details"><summary>Execution settings and measurements</summary><dl className="detail-grid">
    <div><dt>Requested execution</dt><dd>{record.requested.kvCacheMode ?? 'none'} cache · batching {record.requested.decodeBatching ? 'on' : 'off'} · temperature {record.requested.temperature} · max {record.requested.maxTokens} tokens</dd></div>
    <div><dt>Reported execution</dt><dd>{g?.kv_cache_mode ?? 'Not reported'} cache · batching {g?.decode_batching === undefined ? 'not reported' : g.decode_batching ? 'on' : 'off'} · {g?.sampling ?? 'sampling not reported'} · temperature {g?.temperature ?? 'not reported'} · max {g?.max_tokens ?? 'not reported'} tokens</dd></div>
    <div><dt>Input / output tokens</dt><dd>{value(m.inputTokens)} / {value(m.outputTokens)}</dd></div>
    <div><dt>Initial queue / prefill</dt><dd>{value(m.initialQueueMs, ' ms')} / {value(m.prefillMs, ' ms')}</dd></div>
    <div><dt>Time to first token</dt><dd>{value(m.ttftMs, ' ms')}</dd></div>
    <div><dt>Decode duration / throughput</dt><dd>{value(m.decodeDurationMs, ' ms')} / {value(m.decodeTokensPerSecond, ' tok/s')}</dd></div>
    <div><dt>Decode steps</dt><dd>{value(m.decodeSteps)}</dd></div>
    <div><dt>Observed decode batch mean / maximum</dt><dd>{value(m.decodeBatchSizeMean)} / {value(m.decodeBatchSizeMax)}</dd></div>
    <div><dt>Engine total latency</dt><dd>{value(m.totalLatencyMs, ' ms')}</dd></div>
    <div><dt>Request ID / finish reason</dt><dd>{record.requestId ?? 'Not reported'} / {record.finishReason ?? 'Not reported'}</dd></div>
    <div><dt>Hardware at submission</dt><dd>{h ? `${h.hardware.provider ?? 'Provider unreported'} · ${h.hardware.gpuName ?? h.device ?? 'GPU unreported'} · ${h.dtype ?? 'precision unreported'}` : 'Not reported'}</dd></div>
    <div><dt>Reported engine / model revision</dt><dd>{g?.engine_revision?.slice(0, 12) ?? 'Not reported'} / {g?.model_revision?.slice(0, 12) ?? 'Not reported'}</dd></div>
  </dl>{h && <details><summary>Runtime snapshot saved with this request</summary><pre>{JSON.stringify({ model: h.model, backend: h.backend, dtype: h.dtype, hardware: h.hardware, identity: h.identity, admission: h.admission }, null, 2)}</pre></details>}<p className="measurement-note">Durations come from the Python engine and include its scheduling behavior; they are not GPU kernel timings or browser round-trip measurements. Missing values stay unavailable. A single request does not establish a speedup.</p></details>
}
