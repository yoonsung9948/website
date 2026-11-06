export function rawEngineInfo() {
  return { worker: { status: 'ok', detail: 'private address', capabilities: {
    model: 'Qwen/Qwen3-8B', backend: 'custom', device: 'cuda:0', dtype: 'float16', config_path: '/private/config',
    kv_cache_modes: ['none', 'dynamic', 'pool'], decode_batching: true, temperature_sampling: true,
    max_seq_len: 2048, pool_slots: 4, pool_allocated_bytes: 1024, max_decode_batch_size: 4, max_active_requests: 4,
    hardware: { gpu_name: 'RTX A5000', visible_gpu_count: 1, vram_bytes_per_gpu: 24 * 2 ** 30, cuda_version: '12.8' },
    identity: { engine_revision: 'abc123', model_revision: 'model123', torch_version: '2.8', secret: 'hidden' },
    env: { HF_TOKEN: 'hidden' },
  } }, admission: { max_concurrent_generations: 4, generation_requests_per_second: 1, generation_burst: 4, rate_limit_enabled: true },
  control_plane: { max_output_tokens: 256, request_timeout_seconds: 180, demo_key: 'hidden' },
  deployment: { provider: 'runpod', requested_gpu: 'requested type', region: null, address: 'private' } }
}
