import { RequestRateLimitError } from './lib/api-errors'
import { useEffect, useRef, useState } from 'react'
import { config, examples, generate, REQUEST_TIMEOUT_MS } from './lib/client'
import Blog from './Blog'
import Experiments from './Experiments'
import MetricsView from './MetricsView'
import type { RequestRecord } from './RequestDetails'
import { useEngineInfo } from './lib/use-engine-info'
import type { CacheMode } from './lib/engine-info'
import Benchmarks from './Benchmarks'
import TerminalInput from './TerminalInput'
import EngineControl, { type EngineDisplayStatus } from './EngineControl'
import { findPost, routeFromHash } from './lib/blog'

type Entry = RequestRecord & { id: number; prompt: string; model: string; output: string; error: string; status: 'waiting' | 'generating' | 'complete' | 'stopped' | 'error' }
type Status = 'Ready' | 'Waiting' | 'Generating' | 'Complete' | 'Stopped' | 'Error'
const mock = config.mode === 'mock'
// TODO: replace with your profile URLs.
const GITHUB_URL = 'https://github.com/yoonsung9948'
const LINKEDIN_URL = 'https://www.linkedin.com/in/yoonsunghwang'
const EMAIL_URL = 'mailto:hello@yoonh.site'
const REPO_URL = 'https://github.com/yoonsung9948/relay'
const iconProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true } as const
export default function App() {
  const [route, setRoute] = useState(() => routeFromHash(location.hash))
  const page = route.page
  const slug = route.page === 'blog' ? route.slug : undefined
  useEffect(() => {
    const navigate = () => { setRoute(routeFromHash(location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => { document.title = page === 'about' ? 'Yoon — About me' : page === 'benchmarks' ? 'Yoon — Benchmarks' : page === 'blog' ? `Yoon — ${slug ? findPost(slug)?.title ?? 'Not found' : 'Blog'}` : 'Yoon — Inference Playground' }, [page, slug])
  const [engineStatus, setEngineStatus] = useState<EngineDisplayStatus>({ label: mock ? 'sample' : 'unknown', message: mock ? 'Sample mode. No engine connected.' : 'Start the engine to begin.', loading: false })
  const { snapshot, error: infoError } = useEngineInfo(!mock && engineStatus.label === 'ready')
  const info = snapshot && !snapshot.stale && engineStatus.label === 'ready' ? snapshot.info : null
  const [experimentBusy, setExperimentBusy] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<Entry[]>([])
  const metrics = history.at(-1)?.metrics ?? {}
  const generation = history.at(-1)?.generation
  const [generationRetryAt, setGenerationRetryAt] = useState<number | null>(null)
  const [clock, setClock] = useState(Date.now)
  const generationRetrySeconds = generationRetryAt === null ? 0 : Math.max(0, Math.ceil((generationRetryAt - clock) / 1000))
  useEffect(() => {
    if (generationRetryAt === null) return
    const tick = () => {
      const now = Date.now()
      setClock(now)
      if (now >= generationRetryAt) setGenerationRetryAt(null)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [generationRetryAt])
  const [status, setStatus] = useState<Status>('Ready')
  const model = info?.model ?? 'configured'
  const [cacheMode, setCacheMode] = useState<CacheMode>('none')
  const [decodeBatching, setDecodeBatching] = useState(false)
  const [maxTokens, setMaxTokens] = useState(64)
  const [temperature, setTemperature] = useState(0)
  useEffect(() => {
    if (!info) return
    if (!info.cacheModes.includes(cacheMode)) setCacheMode('none')
    if (cacheMode !== 'pool' || !info.decodeBatching) setDecodeBatching(false)
    if (!info.temperatureSampling) setTemperature(0)
    if (maxTokens > info.maxOutputTokens) setMaxTokens(info.maxOutputTokens)
  }, [info, cacheMode, maxTokens])
  const [copyStatus, setCopyStatus] = useState('Copy output')
  const controller = useRef<AbortController | null>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const entryId = useRef(0)
  const output = history.at(-1)?.output ?? ''
  const canHover = () => window.matchMedia('(hover: hover)').matches
  const followOutput = useRef(true)
  const busy = experimentBusy || status === 'Waiting' || status === 'Generating'
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (followOutput.current && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight }, [history, prompt, engineStatus])
  useEffect(() => { if (page === 'playground' && canHover()) document.getElementById('prompt')?.focus({ preventScroll: true }) }, [page])
  async function run() {
    if (controller.current || generationRetrySeconds > 0 || !prompt.trim() || (!mock && !info)) return
    const submittedPrompt = prompt
    const requested = { prompt: prompt.trim(), model, maxTokens, temperature, kvCacheMode: cacheMode, decodeBatching }
    const hardware = info ? structuredClone(info) : undefined
    const active = new AbortController()
    controller.current = active
    const id = ++entryId.current
    const patch = (change: (entry: Entry) => Entry) => setHistory(entries => entries.map(entry => entry.id === id ? change(entry) : entry))
    setHistory(entries => [...entries, { id, requested, hardware, prompt: prompt.trim(), model, output: '', error: '', status: 'waiting' as const }].slice(-30))
    setPrompt(''); setCopyStatus('Copy output'); setStatus('Waiting'); followOutput.current = true
    termRef.current?.focus({ preventScroll: true })
    const timeout = window.setTimeout(() => active.abort(new Error('The request timed out after 190 seconds.')), REQUEST_TIMEOUT_MS)
    try {
      for await (const event of generate(requested, active.signal)) {
        if (event.type === 'delta') { patch(entry => ({ ...entry, output: entry.output + event.text, status: 'generating' })); setStatus('Generating') }
        else if (event.type === 'metrics') patch(entry => ({ ...entry, metrics: event.metrics }))
        else if (event.type === 'generation') patch(entry => ({ ...entry, generation: event.generation, model: event.generation.model ?? entry.model }))
        else patch(entry => ({ ...entry, requestId: event.requestId, finishReason: event.finishReason }))
      }
      patch(entry => ({ ...entry, status: 'complete' })); setStatus('Complete')
    } catch (cause) {
      if (cause instanceof Error && !active.signal.aborted) setPrompt(current => current || submittedPrompt)
      if (cause instanceof RequestRateLimitError) {
        setGenerationRetryAt(cause.retryAt)
        setClock(Date.now())
        setPrompt(current => current || submittedPrompt)
      }
      if (active.signal.aborted && active.signal.reason?.name === 'AbortError') { patch(entry => ({ ...entry, status: 'stopped' })); setStatus('Stopped') }
      else { const message = cause instanceof Error ? cause.message : 'Unable to reach the API. Check the connection and CORS settings.'; patch(entry => ({ ...entry, status: 'error', error: message })); setStatus('Error') }
    } finally { clearTimeout(timeout); controller.current = null }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(output); setCopyStatus('Copied') }
    catch { setCopyStatus('Copy unavailable — select text') }
  }
  return <div className="min-h-screen flex flex-col">
    <a className="skip-link" href={page === 'about' ? '#about-heading' : page === 'benchmarks' ? '#benchmarks-heading' : '#prompt'} onClick={page === 'blog' ? event => { event.preventDefault(); document.getElementById('blog-heading')?.focus() } : undefined}>Skip to content</a>
    <header className="menu-bar"><div className="menu-inner"><a className="identity" href="#playground" aria-label="Yoon home"><img className="brand-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="26" height="26"/>Yoon</a><nav aria-label="Main navigation"><a href="#playground" aria-current={page === 'playground' ? 'page' : undefined}>Playground</a><a href="#benchmarks" aria-current={page === 'benchmarks' ? 'page' : undefined}>Benchmarks</a><a href="#blog" aria-current={page === 'blog' ? 'page' : undefined}>Blog</a><a href="#about" aria-current={page === 'about' ? 'page' : undefined}>About me</a></nav><span className="menu-note">Personal computing, again.</span></div></header>
    <main id="playground" className="page-shell flex-1" hidden={page !== 'playground'}>
      <div className="intro flex items-end justify-between gap-4"><div><p className="eyebrow">INDEPENDENT SYSTEMS / EXPERIMENT 001</p><h1>Inference playground<span className="period">.</span></h1><p className="intro-description">A custom engine. A Go control plane. A place to try it.</p></div><span className="edition">WORK IN PROGRESS<br/>REVISION 0.1</span></div>
      <section className="mac-window" aria-label="Inference playground">
        <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2>inference — playground</h2><div className="title-lines" aria-hidden="true"/><span className="window-box small" aria-hidden="true"/></div>
        <div className="toolbar flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="mode-badge"><span className="status-square"/>{mock ? 'Sample mode' : 'Live API'}</span><span className="toolbar-note">{mock ? 'Authored responses · no model connected' : 'Custom inference endpoint'}</span></div><span className="mono text-xs">SESSION / 001</span></div>
        <div ref={termRef} className="terminal" tabIndex={0} role="region" aria-label="Terminal" aria-busy={busy}
          onClick={event => { if ((event.target as HTMLElement).closest('details,button,a,input,select,textarea')) return; if (!window.getSelection()?.toString()) document.getElementById('prompt')?.focus({ preventScroll: true }) }}
          onKeyDown={event => { if (busy && event.ctrlKey && event.key.toLowerCase() === 'c') { event.preventDefault(); controller.current?.abort() } }}
          onScroll={event => { const el = event.currentTarget; followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
          <div className="sr-only" role="status">{status === 'Ready' ? '' : status}</div>
          <div className="terminal-banner"><p>Inference shell / v0.1</p><p>{mock ? "Sample session. No model connected." : "Live API endpoint configured."}</p></div>
          {history.map(entry => <div className="term-entry" key={entry.id}>
            <p className="shell-command term-line"><span className="term-prefix">yoon@inference:~$ </span><span className="term-typed">{entry.prompt}</span></p>
            {entry.status === 'waiting' && <p className="shell-status" aria-hidden="true">[waiting] awaiting response<span className="cursor" aria-hidden="true"/></p>}
            {entry.output && <p className="shell-command term-line response-line"><span className="term-prefix out-prefix" aria-hidden="true">{entry.model}:~$ </span><span className="response-text">{entry.output}{entry.status === 'generating' && <span className="cursor" aria-hidden="true"/>}</span></p>}
            {entry.error && <p className="error-message" role="alert">{entry.error}</p>}
            {(entry.status === 'stopped' || entry.status === 'error') && <p className="shell-status" aria-hidden="true">[{entry.status}]</p>}
          </div>)}
          <div className="terminal-engine-status" role="status" aria-live="polite" aria-atomic="true">
            <span className="terminal-engine-prefix">engine:~$</span>
            {engineStatus.loading && <span className="terminal-spinner" aria-hidden="true"><span className="terminal-spinner-frames"><span>|</span><span>/</span><span>—</span><span>\</span><span>|</span></span></span>}
            <span><span className="terminal-engine-state">[{engineStatus.label}]</span> {engineStatus.message}</span>
          </div>
          {!busy && <form id="generation-form" className="term-entry" onSubmit={event => { event.preventDefault(); void run() }}>
            <div className="shell-command term-line"><span className="term-prefix" aria-hidden="true">yoon@inference:~$ </span><TerminalInput value={prompt} onChange={setPrompt} onSubmit={() => void run()} placeholder="Ask the model something…" autoFocus={history.length > 0 && canHover()}/></div>
          </form>}
        </div>
        <section className="instrument-panel" aria-label="Generation controls and request metrics">
          <div className="instrument-heading"><h3>Generation / request metrics</h3><button className="copy-button" type="button" onClick={() => void copy()} disabled={!output || busy}>{copyStatus}</button></div>
            <div className="examples flex flex-wrap gap-2"><span>Try</span>{examples.map(example => <button key={example.label} type="button" disabled={busy} onClick={() => setPrompt(example.prompt)}>{example.label} <span aria-hidden="true">↗</span></button>)}</div>
            <EngineControl generating={busy} onStatusChange={setEngineStatus} snapshot={snapshot ? { ...snapshot, stale: snapshot.stale || engineStatus.label !== 'ready' } : null} infoError={infoError}/>
            <div className="controls flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap items-center gap-5">
              <label>Max tokens <input type="number" min="1" max={info?.maxOutputTokens ?? 64} value={maxTokens} onChange={event => setMaxTokens(Math.max(1, Math.min(info?.maxOutputTokens ?? 64, Number(event.target.value))))} disabled={busy || !info}/></label>
              <label>Temperature <input type="number" min="0" step="0.1" value={temperature} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setTemperature(Math.max(0, value)) }} disabled={busy || !info?.temperatureSampling}/></label>
              <label>KV cache <select value={cacheMode} onChange={event => setCacheMode(event.target.value as CacheMode)} disabled={busy || !info}>{(info?.cacheModes ?? ['none']).map(mode => <option key={mode} value={mode}>{mode === 'none' ? 'None' : mode === 'dynamic' ? 'Dynamic' : 'Pooled'}</option>)}</select></label>
              <label className="checkbox-label"><input type="checkbox" checked={decodeBatching} onChange={event => setDecodeBatching(event.target.checked)} disabled={busy || cacheMode !== 'pool' || !info?.decodeBatching}/> Decode batching</label>
            </div>{busy ? <button type="button" className="generate" onClick={() => controller.current?.abort()}>Stop <span aria-hidden="true">■</span></button> : <button type="submit" form="generation-form" className="generate" disabled={!prompt.trim() || generationRetrySeconds > 0 || (!mock && !info)}>{generationRetrySeconds > 0 ? `Retry in ${generationRetrySeconds}s` : 'Generate'} <span aria-hidden="true">↵</span></button>}</div>
        <MetricsView metrics={metrics}/>
          {!mock && <Experiments snapshot={snapshot} request={{ prompt, model, maxTokens, temperature, kvCacheMode: cacheMode, decodeBatching }} disabled={busy || !info || generationRetrySeconds > 0}
            onBegin={active => { if (controller.current) return false; controller.current = active; setExperimentBusy(true); return true }}
            onEnd={active => { if (controller.current === active) controller.current = null; setExperimentBusy(false) }}/>} 
          {generation && <p className="measurement-note">{generation.model ?? 'Model unreported'} · {generation.sampling ?? 'Sampling unreported'} · output cap {generation.max_tokens ?? maxTokens} tokens · latest request</p>}
        </section>
        <div className="window-status"><span>{mock ? 'Sample playback. No model execution or measured performance.' : 'POST /generate · SSE · engine measurements'} </span><span className="resize-mark" aria-hidden="true">◩</span></div>
      </section>
      <div className="below-window flex flex-wrap justify-between gap-3"><p><span className="footnote-mark">↳</span> Built to understand what happens between prompt and token.</p><p className="mono">Enter to run · Shift + Enter for a new line · Ctrl + C to stop</p></div>
      <section className="mac-window overview" aria-labelledby="overview-title">
        <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2 id="overview-title">inference — about.txt</h2><div className="title-lines" aria-hidden="true"/></div>
        <div className="about-content"><p className="sample-label">ABOUT THIS PLAYGROUND</p><h2>What is this?</h2><p>A small inference platform, built from scratch: a Go control plane in front of a custom engine that serves a single model. This page is the front door. Type a prompt, watch the reply arrive, and read the timings the engine reports.</p>
          <div className="about-details three"><section><h3>What you’re looking at</h3><p>A terminal-style client for the engine. Time to first token, decode throughput, token count and total latency all come from the server, never from a guess in the browser.</p></section><section><h3>Where it stands</h3><p>Work in progress. While no engine is connected, the playground runs in sample mode with authored responses and shows no invented performance numbers.</p></section><section><h3>Follow along</h3><p>Design notes and benchmark write-ups go on the <a className="inline-link" href="#blog">blog</a>. The code is open, and everything is built in public.</p></section></div>
          <a className="about-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">View the source on GitHub <span aria-hidden="true">↗</span></a></div>
        <div className="window-status"><span>Small surface. Deep stack.</span><span className="resize-mark" aria-hidden="true">◩</span></div>
      </section>
    </main>
    {page === 'benchmarks' && <main className="page-shell flex-1"><Benchmarks/></main>}
    {page === 'blog' && <main className="page-shell blog-page flex-1"><Blog slug={slug}/></main>}
    <main className="page-shell about-page flex-1" hidden={page !== 'about'}>
      <div className="intro"><p className="eyebrow">A LITTLE CONTEXT</p><h1 id="about-heading" tabIndex={-1}>About me<span className="period">.</span></h1><p className="intro-description">The person behind the playground.</p></div>
      <section className="mac-window" aria-labelledby="about-title">
        <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2 id="about-title">yoon — readme.txt</h2><div className="title-lines" aria-hidden="true"/></div>
        <div className="about-content"><p className="sample-label">SAMPLE BIO / EDIT TO MAKE IT YOURS</p><h2>Hi, I’m Yoon.</h2><p>I’m building a custom inference platform: a Go control plane and an engine that turns prompts into tokens. This site is my working space for that project.</p><p>I’m interested in how systems behave under real constraints — fixed hardware, limited memory, and a latency budget. I like understanding where the time goes, then making the critical path faster.</p><div className="about-details"><section><h3>Currently building</h3><p>An inference engine and a small playground to make its behavior visible.</p></section><section><h3>Things I’m exploring</h3><p>Scheduling, KV cache management, GPU utilization, and honest performance measurement.</p></section><section className="about-links"><h3>Links</h3><ul><li><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub"><svg {...iconProps}><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg></a></li><li><a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><svg {...iconProps}><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/></svg></a></li><li><a href={EMAIL_URL} aria-label="Email hello@yoonh.site" title="hello@yoonh.site"><svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="1"/><path d="m3 6 9 7 9-7"/></svg></a></li></ul></section></div><a className="about-link" href="#playground">Back to the playground <span aria-hidden="true">↗</span></a></div>
        <div className="window-status"><span>A short introduction. More to come.</span><span className="resize-mark" aria-hidden="true">◩</span></div>
      </section>
    </main>
    <footer className="page-footer"><span>Yoon <span className="footer-slash">/</span> Systems in progress</span><span>Small surface. Deep stack.</span></footer>
  </div>
}
