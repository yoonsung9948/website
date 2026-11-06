import type { EngineSnapshot } from './lib/use-engine-info'
const reported = (value: string | number | null | undefined) => value == null || value === '' ? 'Not reported' : value
export default function EngineFacts({ snapshot, error }: { snapshot: EngineSnapshot | null; error: string }) {
  if (!snapshot) return <p className="measurement-note">{error || 'Engine details are available after startup.'}</p>
  const { info, fetchedAt, stale } = snapshot, { hardware: h, identity: i } = info
  return <>
    <p className="engine-hardware-summary">{reported(h.provider)} · {h.gpuName ?? (h.requestedGPU ? `Requested: ${h.requestedGPU}` : info.device ?? 'Hardware not reported')}
      {h.vramBytesPerGPU !== null && ` · ${(h.vramBytesPerGPU / 2 ** 30).toFixed(1)} GiB VRAM / GPU`} · {reported(info.model)}{stale && ' · stale snapshot'}</p>
    {error && <p className="measurement-note" role="status">{error}</p>}
    <details className="engine-facts"><summary>Runtime and serving details</summary><dl className="detail-grid">
      <div><dt>Provider / region</dt><dd>{reported(h.provider)} / {reported(h.region)}</dd></div>
      <div><dt>Requested GPU</dt><dd>{reported(h.requestedGPU)}</dd></div>
      <div><dt>Worker-reported GPU / visible count</dt><dd>{reported(h.gpuName)} / {reported(h.visibleGPUCount)}</dd></div>
      <div><dt>Backend / precision</dt><dd>{reported(info.backend)} / {reported(info.dtype)}</dd></div>
      <div><dt>CUDA / PyTorch</dt><dd>{reported(h.cudaVersion)} / {reported(i.torchVersion)}</dd></div>
      <div><dt>Engine revision</dt><dd title={i.engineRevision ?? ''}>{i.engineRevision?.slice(0, 12) ?? 'Not reported'}</dd></div>
      <div><dt>Model revision</dt><dd title={i.modelRevision ?? ''}>{i.modelRevision?.slice(0, 12) ?? 'Not reported'}</dd></div>
      <div><dt>Go requests in flight / limit</dt><dd>{info.admission.inFlight} / {info.admission.maxConcurrent}</dd></div>
      <div><dt>Engine active / pending</dt><dd>{info.activeRequests} / {info.pendingRequests}</dd></div>
      <div><dt>Request rate / burst</dt><dd>{info.admission.limited ? `${info.admission.requestsPerSecond}/s · burst ${info.admission.burst}` : 'Temporal limits disabled'}</dd></div>
      <div><dt>Pool slots / allocated memory</dt><dd>{info.poolSlots} / {(info.poolAllocatedBytes / 2 ** 20).toFixed(1)} MiB</dd></div>
      <div><dt>Output / context budget</dt><dd>{info.maxOutputTokens} / {reported(info.maxSeqLen)} tokens</dd></div>
    </dl><p className="measurement-note">Last confirmed {new Date(fetchedAt).toLocaleTimeString()}. Occupancy is a snapshot, not reserved capacity. {stale ? 'Refresh must succeed before live controls resume.' : ''}</p></details>
  </>
}
