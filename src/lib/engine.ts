import { config, type ApiConfig } from './client'

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

export async function requestEngineStart(signal: AbortSignal, settings = config): Promise<void> {
  const response = await fetch(endpoint('start_engine', settings), { method: 'POST', signal })
  const body = await response.text()
  // The current Go handler writes a 200 prefix before reporting errors. Check its
  // legacy text too; acceptance still does not mean the GPU/model is ready.
  if (!response.ok || /error starting engine/i.test(body)) {
    throw new Error(`The start request was not accepted (HTTP ${response.status}). Check engine status before trying again.`)
  }
}
