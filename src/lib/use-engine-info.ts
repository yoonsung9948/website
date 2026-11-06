import { useEffect, useState } from 'react'
import { config } from './client'
import { parsePublicEngineInfo, type EngineInfo } from './engine-info'
export type EngineSnapshot = { info: EngineInfo; fetchedAt: number; stale: boolean }
export function useEngineInfo(ready: boolean) {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!ready || config.mode !== 'live') {
      setSnapshot(previous => previous ? { ...previous, stale: true } : null)
      return
    }
    const controller = new AbortController()
    let fetching = false
    async function refresh() {
      if (fetching || document.visibilityState === 'hidden') return
      fetching = true
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/engine/info`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]), cache: 'no-store' })
        if (!response.ok) throw new Error('Engine details unavailable. Live controls will resume after a successful refresh.')
        const info = parsePublicEngineInfo(await response.json())
        if (!controller.signal.aborted) { setSnapshot({ info, fetchedAt: Date.now(), stale: false }); setError('') }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setSnapshot(previous => previous ? { ...previous, stale: true } : null)
          setError(cause instanceof Error ? cause.message : 'Engine details unavailable.')
        }
      } finally { fetching = false }
    }
    const visible = () => { if (document.visibilityState === 'visible') { setSnapshot(previous => previous ? { ...previous, stale: true } : null); void refresh() } }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [ready])
  return { snapshot, error }
}
