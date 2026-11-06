export type StartRestriction = { reason: 'cooldown' | 'capacity'; retryAt: number }

export function retrySeconds(restriction: StartRestriction | null, now: number): number {
  return restriction ? Math.max(0, Math.ceil((restriction.retryAt - now) / 1000)) : 0
}

// Session storage is only a UI hint. Admission always belongs to the backend.
export function readStartRestriction(storage: Storage, key: string, now = Date.now()): StartRestriction | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as Partial<StartRestriction> | null
    if (value && (value.reason === 'cooldown' || value.reason === 'capacity') &&
        typeof value.retryAt === 'number' && Number.isFinite(value.retryAt) && value.retryAt > now) {
      return { reason: value.reason, retryAt: value.retryAt }
    }
    storage.removeItem(key)
  } catch { /* Storage may be unavailable or contain an old value. */ }
  return null
}

export function saveStartRestriction(storage: Storage, key: string, value: StartRestriction | null): void {
  try {
    if (value) storage.setItem(key, JSON.stringify(value))
    else storage.removeItem(key)
  } catch { /* Storage is optional; the live UI and backend still enforce the limit. */ }
}
