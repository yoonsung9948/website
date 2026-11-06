import { expect, it } from 'vitest'
import { readStartRestriction, retrySeconds, saveStartRestriction } from './engine-retry'
function storage(): Storage {
  const map = new Map<string, string>()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value) }, removeItem: key => { map.delete(key) }, clear: () => map.clear(), key: i => [...map.keys()][i] ?? null, get length() { return map.size } }
}
it('restores a retry deadline after refresh and scopes it to the backend', () => {
  const store = storage()
  saveStartRestriction(store, '/api', { reason: 'cooldown', retryAt: 20_000 })
  expect(readStartRestriction(store, '/api', 1000)).toEqual({ reason: 'cooldown', retryAt: 20_000 })
  expect(readStartRestriction(store, '/other-api', 1000)).toBeNull()
  expect(readStartRestriction(store, '/api', 20_000)).toBeNull()
  expect(store.getItem('/api')).toBeNull()
})
it('uses absolute deadlines across suspended tabs and clamps expired timers', () => {
  const restriction = { reason: 'capacity' as const, retryAt: 20_000 }
  expect(retrySeconds(restriction, 1001)).toBe(19)
  expect(retrySeconds(restriction, 30_000)).toBe(0)
})
it('ignores corrupt storage and tolerates storage failures', () => {
  const store = storage()
  store.setItem('/api', '{broken')
  expect(readStartRestriction(store, '/api', 0)).toBeNull()
  store.setItem = () => { throw new Error('disabled') }
  expect(() => saveStartRestriction(store, '/api', { reason: 'capacity', retryAt: 20_000 })).not.toThrow()
})
