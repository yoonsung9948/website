import { useCallback, useEffect, useRef, useState } from 'react'
import EngineFacts from './EngineFacts'
import type { EngineSnapshot } from './lib/use-engine-info'
import { config } from './lib/client'
import { CooldownError, EngineStateConflictError, NoGpuAvailableError, readEngineState, requestEngineStart, type EngineState } from './lib/engine'
import { readStartRestriction, retrySeconds, saveStartRestriction, type StartRestriction } from './lib/engine-retry'

const labels: Record<EngineState, string> = {
  offline: 'Offline', provisioning: 'Provisioning', starting: 'Starting',
  loading_model: 'Loading model', warming: 'Warming up', ready: 'Ready',
  error: 'Engine error', shutting_down: 'Shutting down',
}
const startingStates: EngineState[] = ['provisioning', 'starting', 'loading_model', 'warming']
export type EngineDisplayStatus = { label: string; message: string; loading: boolean }

function storedRestriction(key: string): StartRestriction | null {
  try { return readStartRestriction(window.sessionStorage, key) } catch { return null }
}

export default function EngineControl({ generating, onStatusChange, snapshot, infoError = '' }: { generating: boolean; onStatusChange: (status: EngineDisplayStatus) => void; snapshot?: EngineSnapshot | null; infoError?: string }) {
  const sample = config.mode !== 'live'
  const storageKey = `engine-start:${config.baseUrl.replace(/\/+$/, '')}`
  const [state, setState] = useState<EngineState | 'unknown'>('unknown')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [needsCheck, setNeedsCheck] = useState(false)
  const [restriction, setRestriction] = useState<StartRestriction | null>(() => storedRestriction(storageKey))
  const [now, setNow] = useState(Date.now)
  const active = useRef<AbortController | null>(null)
  const seconds = retrySeconds(restriction, now)
  const starting = state !== 'unknown' && startingStates.includes(state)
  const blocked = state !== 'ready' && seconds > 0

  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    try { saveStartRestriction(window.sessionStorage, storageKey, restriction) } catch { /* Optional storage. */ }
  }, [restriction, storageKey])
  useEffect(() => {
    if (!restriction) return
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (restriction.retryAt <= time) {
        setRestriction(null)
        if (state === 'offline') setMessage('Engine is offline. You can start it now.')
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [restriction, state])

  const applyState = useCallback((current: EngineState) => {
    setState(current)
    if (current === 'ready') {
      setMessage('Engine ready for requests.')
      setNeedsCheck(false)
    } else if (current === 'offline') {
      setMessage('Engine is offline. You can start it now.')
      setNeedsCheck(false)
    } else if (current === 'error') {
      setMessage('The engine reported an error. Check the control plane before restarting.')
      setNeedsCheck(true)
    } else {
      setMessage(`${labels[current]}. This may take a few minutes.`)
    }
  }, [])

  const checkStatus = useCallback(async () => {
    if (sample || active.current) return
    const controller = new AbortController()
    active.current = controller
    try {
      applyState(await readEngineState(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])))
    } catch {
      if (!controller.signal.aborted) {
        setState('unknown')
        setNeedsCheck(true)
        setMessage('Unable to check the engine. Check status before starting again.')
      }
    } finally {
      if (active.current === controller) active.current = null
    }
  }, [sample, applyState])

  // Polling only reads status. A timer, refresh, or focus event never rents a GPU.
  useEffect(() => {
    if (sample) return
    void checkStatus()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkStatus()
    }, starting ? 2500 : 10_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void checkStatus() }
    const onFocus = () => { void checkStatus() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [sample, starting, checkStatus])

  async function start() {
    if (sample || active.current || pending || generating || blocked) return
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)])
    try {
      const current = await readEngineState(signal)
      applyState(current)
      // After an uncertain response, this click only confirms the state.
      if (current !== 'offline' || needsCheck) return
      setNeedsCheck(true)
      setMessage('Sending start request…')
      await requestEngineStart(signal)
      applyState('provisioning')
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof EngineStateConflictError) {
        // Another caller won startup admission. Reconcile without another POST.
        try { applyState(await readEngineState(signal)) }
        catch {
          setState('unknown')
          setNeedsCheck(true)
          setMessage('Unable to confirm the engine state. Check status before starting again.')
        }
        return
      }
      if (error instanceof CooldownError || error instanceof NoGpuAvailableError) {
        const reason = error instanceof CooldownError ? 'cooldown' : 'capacity'
        setRestriction(error.retryAt === null ? null : { reason, retryAt: error.retryAt })
        setNow(Date.now())
        setState('offline')
        setNeedsCheck(false)
      } else {
        setState('unknown')
        setNeedsCheck(true)
      }
      setMessage(error instanceof Error ? error.message : 'Unable to confirm startup. Check status before retrying.')
    } finally {
      if (active.current === controller) active.current = null
      setPending(false)
    }
  }

  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const displayMessage = sample ? 'Sample mode. No engine connected.'
    : blocked && !starting && state !== 'error'
      ? `${restriction?.reason === 'capacity' ? 'No GPUs available.' : 'Start limit reached.'} Try again in ${countdown}.`
      : message || 'Checking engine status…'
  const displayLabel = sample ? 'sample' : blocked && state === 'offline'
    ? restriction?.reason === 'capacity' ? 'no_gpu_available' : 'cooldown' : state

  useEffect(() => {
    onStatusChange({ label: displayLabel, message: displayMessage, loading: !sample && (pending || starting) })
  }, [displayLabel, displayMessage, sample, pending, starting, onStatusChange])

  return <div className="engine-control">
    <div className="engine-description">
      <span className="engine-label">Engine <span className="engine-state">{sample ? 'Sample mode' : state === 'unknown' ? 'Status unknown' : labels[state]}</span></span>
      <p id="engine-status">{displayMessage}</p>
      {!sample && <EngineFacts snapshot={snapshot ?? null} error={infoError}/>}
    </div>
    <button type="button" className="engine-start" disabled={sample || pending || generating || (blocked && !starting && state !== 'error')} aria-describedby="engine-status" onClick={() => void start()}>
      <span aria-hidden="true">⏻</span> {pending ? 'Checking…' : starting ? 'Starting…' : blocked && state !== 'error' ? `Try again in ${countdown}` : needsCheck || state === 'ready' || state === 'unknown' ? 'Check status' : 'Start engine'}
    </button>
  </div>
}
