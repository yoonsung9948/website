// Missing or malformed headers do not invent a backend retry policy.
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null
  const text = value.trim()
  if (/^\d+$/.test(text)) {
    const deadline = now + Number(text) * 1000
    return Number.isFinite(deadline) ? deadline : null
  }
  // Reject numeric-looking invalid delays rather than interpreting them as dates.
  if (!/[a-z]/i.test(text)) return null
  const deadline = Date.parse(text)
  return Number.isFinite(deadline) ? Math.max(now, deadline) : null
}

export type ApiFailure = { code: string | null; retryAt: number | null }

export async function readApiFailure(response: Response): Promise<ApiFailure> {
  let code: string | null = null
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') code = body.error
  } catch { /* Proxies may return plain text or HTML. Do not guess an error category. */ }
  return { code, retryAt: parseRetryAfter(response.headers.get('Retry-After')) }
}

export class RequestRateLimitError extends Error {
  constructor(readonly retryAt: number | null) {
    const seconds = retryAt === null ? null : Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))
    super(seconds === null ? 'Too many generation requests. Please wait before trying again.' : `Too many generation requests. Try again in ${seconds} seconds.`)
    this.name = 'RequestRateLimitError'
  }
}

export class GenerationCapacityError extends Error {
  constructor() {
    super('The engine is busy with other requests. Try again when a request finishes.')
    this.name = 'GenerationCapacityError'
  }
}

export class EngineCapacityError extends Error {
  constructor() { super('The engine has no queue or cache capacity for this request. Try a smaller request or wait for current work to finish.'); this.name = 'EngineCapacityError' }
}
export class InvalidExecutionError extends Error {
  constructor() { super('The engine rejected these execution settings or context length. Refresh engine details and check the output budget and cache mode.'); this.name = 'InvalidExecutionError' }
}
