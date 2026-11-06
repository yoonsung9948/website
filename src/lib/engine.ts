import { config, type ApiConfig } from './client'
import { readApiFailure } from './api-errors'

export const engineStates = ['offline', 'provisioning', 'starting', 'loading_model', 'warming', 'ready', 'error', 'shutting_down'] as const
export type EngineState = typeof engineStates[number]

function endpoint(path: string, settings: ApiConfig) {
  if (settings.mode !== 'live') throw new Error('Starting the engine is available in live mode.')
  if (!settings.baseUrl) throw new Error('The engine connection is not configured.')
  return `${settings.baseUrl.replace(/\/+$/, '')}/${path}`
}

export async function readEngineState(signal: AbortSignal, settings = config): Promise<EngineState> {
  const response = await fetch(endpoint('health', settings), { signal, cache: 'no-store', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Unable to check the engine (HTTP ${response.status}).`)
  const body = await response.json()
  if (!body || !engineStates.includes(body.state)) throw new Error('The engine returned an unrecognized status.')
  return body.state
}

export { parseRetryAfter } from './api-errors'

export class CooldownError extends Error {
  constructor(readonly retryAt: number | null) {
    super('Start limit reached. Please wait before trying again.')
    this.name = 'CooldownError'
  }
}

export class NoGpuAvailableError extends Error {
  constructor(readonly retryAt: number | null = null) {
    super('No GPUs are available right now. Please try again in a few minutes.')
    this.name = 'NoGpuAvailableError'
  }
}

export class EngineStateConflictError extends Error {
  constructor() {
    super('The engine state changed. Checking its current status.')
    this.name = 'EngineStateConflictError'
  }
}

export async function requestEngineStart(signal: AbortSignal, settings = config): Promise<void> {
  const response = await fetch(endpoint('start_engine', settings), { method: 'POST', signal })
  if (!response.ok) {
    const { code, retryAt } = await readApiFailure(response)
    if (response.status === 429 && code === 'provision_cooldown') throw new CooldownError(retryAt)
    if (response.status === 503 && code === 'no_gpu_available') throw new NoGpuAvailableError(retryAt)
    if (response.status === 409 && code === 'engine_state_conflict') throw new EngineStateConflictError()
    throw new Error(`The start request was not accepted (HTTP ${response.status}). Check engine status before trying again.`)
  }
  let body: unknown
  try { body = await response.json() } catch { body = undefined }
  if (response.status !== 202 || !body || typeof body !== 'object' || !('status' in body) || body.status !== 'starting') {
    throw new Error('The engine returned an unexpected startup response. Check engine status before trying again.')
  }
  // Accepted means startup is in progress. Health polling determines readiness.
}
