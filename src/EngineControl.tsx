import { useEffect, useRef, useState } from 'react'
import { config } from './lib/client'
import { readEngineState, requestEngineStart, type EngineState } from './lib/engine'

const labels: Record<EngineState, string> = {
  offline: 'Offline', provisioning: 'Provisioning', starting: 'Starting',
  loading_model: 'Loading model', warming: 'Warming up', ready: 'Ready',
  error: 'Engine error', shutting_down: 'Shutting down',
}

export default function EngineControl({ generating }: { generating: boolean }) {
  const sample = config.mode !== 'live'
  const [state, setState] = useState<EngineState | 'unknown'>('unknown')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [needsCheck, setNeedsCheck] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  async function start() {
    if (sample || active.current) return
    const controller = new AbortController()
    active.current = controller
    const timeout = window.setTimeout(() => controller.abort(new Error('Status checks timed out. The engine may still be starting.')), 300_000)
    setPending(true); setMessage('Checking engine…')
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(310_000)])
    const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(55_000)])
    try {
      let current = await readEngineState(requestSignal())
      setState(current)
      if (current === 'offline' && !needsCheck) {
        // An uncertain response must lead to a status check, never an automatic retry.
        setNeedsCheck(true)
        setMessage('Sending start request…')
        await requestEngineStart(requestSignal())
        current = 'provisioning'
        setState(current)
      } else if (current === 'offline') {
        setNeedsCheck(false)
        setMessage('Engine is offline. You can start it now.')
        return
      }
      while (true) {
        if (current === 'ready') { setMessage('Engine ready for requests.'); setNeedsCheck(false); return }
        if (current === 'error') { setMessage('The engine reported an error. Check the control plane before restarting.'); setNeedsCheck(true); return }
        if (current === 'offline') { setMessage('Engine returned offline. You can try starting it again.'); setNeedsCheck(false); return }
        setMessage(`${labels[current]}. This may take a few minutes.`)
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason) }
          const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 2500)
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
        current = await readEngineState(requestSignal())
        setState(current)
      }
    } catch (error) {
      setState('unknown'); setNeedsCheck(true)
      setMessage(error instanceof Error ? error.message : 'Unable to reach the control plane. Check status before retrying.')
    } finally {
      clearTimeout(timeout); active.current = null; setPending(false)
    }
  }

  return <div className="engine-control">
    <div className="engine-description"><span className="engine-label">Engine <span className="engine-state">{sample ? 'Sample mode' : state === 'unknown' ? 'Status unknown' : labels[state]}</span></span><p id="engine-status" role="status">{sample ? 'Connect the live API to start the engine.' : message || 'Start the engine before sending your first prompt.'}</p></div>
    <button type="button" className="engine-start" disabled={sample || pending || generating} aria-describedby="engine-status" onClick={() => void start()}><span aria-hidden="true">⏻</span> {pending ? 'Starting…' : needsCheck || state === 'ready' ? 'Check status' : 'Start engine'}</button>
  </div>
}
