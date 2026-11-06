export type CacheMode = 'none' | 'dynamic' | 'pool'
export type EngineInfo = {
  model: string | null; backend: string | null; device: string | null; dtype: string | null
  cacheModes: CacheMode[]; decodeBatching: boolean; temperatureSampling: boolean
  maxOutputTokens: number; maxSeqLen: number | null; poolSlots: number; poolAllocatedBytes: number
  maxDecodeBatchSize: number; maxActiveRequests: number; activeRequests: number; pendingRequests: number
  requestTimeoutSeconds: number
  admission: { inFlight: number; maxConcurrent: number; requestsPerSecond: number; burst: number; limited: boolean }
  hardware: { provider: string | null; requestedGPU: string | null; region: string | null; gpuName: string | null; visibleGPUCount: number | null; vramBytesPerGPU: number | null; cudaVersion: string | null }
  identity: { engineRevision: string | null; engineSourceSHA256: string | null; modelRevision: string | null; configSHA256: string | null; torchVersion: string | null; transformersVersion: string | null }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const count = (value: unknown): number | null => Number.isInteger(value) ? number(value) : null

/** Allowlist the public API. Never forward raw configuration, addresses, or provider responses. */
export function sanitizeEngineInfo(value: unknown): EngineInfo {
  const raw = object(value), worker = object(raw.worker), caps = object(worker.capabilities)
  const admission = object(raw.admission), control = object(raw.control_plane)
  const hardware = object(caps.hardware), identity = object(caps.identity), deployment = object(raw.deployment)
  const maxOutput = count(control.max_output_tokens)
  if (worker.status !== 'ok' || !maxOutput || !Array.isArray(caps.kv_cache_modes) || !caps.kv_cache_modes.includes('none')) throw new Error('Engine capabilities are unavailable or incompatible.')
  const modes = [...new Set(caps.kv_cache_modes.filter((mode): mode is CacheMode => ['none', 'dynamic', 'pool'].includes(String(mode))))]
  return {
    model: text(caps.model), backend: text(caps.backend), device: text(caps.device), dtype: text(caps.dtype),
    cacheModes: modes, decodeBatching: caps.decode_batching === true && modes.includes('pool'), temperatureSampling: caps.temperature_sampling === true,
    maxOutputTokens: maxOutput, maxSeqLen: count(caps.max_seq_len), poolSlots: count(caps.pool_slots) ?? 0, poolAllocatedBytes: count(caps.pool_allocated_bytes) ?? 0,
    maxDecodeBatchSize: count(caps.max_decode_batch_size) ?? 0, maxActiveRequests: count(caps.max_active_requests) ?? 0,
    activeRequests: count(caps.active_requests) ?? 0, pendingRequests: count(caps.pending_requests) ?? 0,
    requestTimeoutSeconds: number(control.request_timeout_seconds) ?? 180,
    admission: { inFlight: count(admission.in_flight_generations) ?? 0, maxConcurrent: count(admission.max_concurrent_generations) ?? 0, requestsPerSecond: number(admission.generation_requests_per_second) ?? 0, burst: count(admission.generation_burst) ?? 0, limited: admission.rate_limit_enabled !== false },
    hardware: { provider: text(deployment.provider), requestedGPU: text(deployment.requested_gpu), region: text(deployment.region), gpuName: text(hardware.gpu_name) ?? (String(caps.device).startsWith('cuda') ? text(identity.device_name) : null), visibleGPUCount: count(hardware.visible_gpu_count), vramBytesPerGPU: count(hardware.vram_bytes_per_gpu), cudaVersion: text(hardware.cuda_version) },
    identity: { engineRevision: text(identity.engine_revision), engineSourceSHA256: text(identity.engine_source_sha256), modelRevision: text(identity.model_revision), configSHA256: text(identity.config_sha256), torchVersion: text(identity.torch_version), transformersVersion: text(identity.transformers_version) },
  }
}

export function batchingDemoLimit(info: EngineInfo): number {
  if (!info.decodeBatching) return 0
  return Math.max(0, Math.min(4, info.poolSlots, info.maxActiveRequests, info.maxDecodeBatchSize,
    info.admission.maxConcurrent, info.admission.limited ? info.admission.burst : Infinity))
}

export function parsePublicEngineInfo(value: unknown): EngineInfo {
  const raw = object(value)
  // Reuse the same allowlist by converting the normalized public shape to its source shape.
  const h = object(raw.hardware), a = object(raw.admission), i = object(raw.identity)
  return sanitizeEngineInfo({ worker: { status: 'ok', capabilities: {
    model: raw.model, backend: raw.backend, device: raw.device, dtype: raw.dtype,
    kv_cache_modes: raw.cacheModes, decode_batching: raw.decodeBatching, temperature_sampling: raw.temperatureSampling,
    max_seq_len: raw.maxSeqLen, pool_slots: raw.poolSlots, pool_allocated_bytes: raw.poolAllocatedBytes,
    max_decode_batch_size: raw.maxDecodeBatchSize, max_active_requests: raw.maxActiveRequests, active_requests: raw.activeRequests, pending_requests: raw.pendingRequests,
    hardware: { gpu_name: h.gpuName, visible_gpu_count: h.visibleGPUCount, vram_bytes_per_gpu: h.vramBytesPerGPU, cuda_version: h.cudaVersion },
    identity: { engine_revision: i.engineRevision, engine_source_sha256: i.engineSourceSHA256, model_revision: i.modelRevision, config_sha256: i.configSHA256, torch_version: i.torchVersion, transformers_version: i.transformersVersion },
  } }, deployment: { provider: h.provider, requested_gpu: h.requestedGPU, region: h.region }, control_plane: { max_output_tokens: raw.maxOutputTokens, request_timeout_seconds: raw.requestTimeoutSeconds },
  admission: { in_flight_generations: a.inFlight, max_concurrent_generations: a.maxConcurrent, generation_requests_per_second: a.requestsPerSecond, generation_burst: a.burst, rate_limit_enabled: a.limited } })
}
