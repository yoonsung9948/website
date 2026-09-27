import { useEffect, useRef, useState } from 'react'
import { config, examples, generate, type Metrics } from './lib/client'

type Status = 'Ready' | 'Waiting' | 'Generating' | 'Complete' | 'Stopped' | 'Error'
const mock = config.mode === 'mock'
function Metric({ label, value, unit, title }: { label: string; value?: number; unit: string; title: string }) {
  return <div className="metric" title={title}><span>{label}</span><div><strong>{value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><small>{unit}</small></div></div>
}
export default function App() {
  const [page, setPage] = useState(() => location.hash.startsWith('#about') ? 'about' : 'playground')
  useEffect(() => {
    const navigate = () => setPage(location.hash.startsWith('#about') ? 'about' : 'playground')
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => { document.title = page === 'about' ? 'Yoon — About me' : 'Yoon — Inference Playground' }, [page])
  const [prompt, setPrompt] = useState(examples[0].prompt)
  const [output, setOutput] = useState('')
  const [metrics, setMetrics] = useState<Metrics>({})
  const [status, setStatus] = useState<Status>('Ready')
  const [error, setError] = useState('')
  const [maxTokens, setMaxTokens] = useState(256)
  const [temperature, setTemperature] = useState(0.7)
  const [copyStatus, setCopyStatus] = useState('Copy output')
  const controller = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const busy = status === 'Waiting' || status === 'Generating'
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (followOutput.current && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight }, [output])
  async function run() {
    if (controller.current || !prompt.trim()) return
    const active = new AbortController()
    controller.current = active
    setOutput(''); setMetrics({}); setError(''); setCopyStatus('Copy output'); setStatus('Waiting'); followOutput.current = true
    const timeout = window.setTimeout(() => active.abort(new Error('The request timed out after 120 seconds.')), 120_000)
    try {
      for await (const event of generate({ prompt: prompt.trim(), maxTokens, temperature }, active.signal)) {
        if (event.type === 'delta') { setOutput(previous => previous + event.text); setStatus('Generating') }
        else setMetrics(previous => ({ ...previous, ...event.metrics }))
      }
      setStatus('Complete')
    } catch (cause) {
      if (active.signal.aborted && active.signal.reason?.name === 'AbortError') setStatus('Stopped')
      else { setStatus('Error'); setError(cause instanceof Error ? cause.message : 'Unable to reach the API. Check the connection and CORS settings.') }
    } finally { clearTimeout(timeout); controller.current = null }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(output); setCopyStatus('Copied') }
    catch { setCopyStatus('Copy unavailable — select text') }
  }
  return <div className="min-h-screen flex flex-col">
    <a className="skip-link" href={page === 'about' ? '#about-heading' : '#prompt'}>Skip to content</a>
    <header className="menu-bar"><div className="menu-inner"><a className="identity" href="#playground" aria-label="Yoon home">Yoon</a><nav aria-label="Main navigation"><a href="#playground" aria-current={page === 'playground' ? 'page' : undefined}>Playground</a><a href="#about" aria-current={page === 'about' ? 'page' : undefined}>About me</a></nav><span className="menu-note">Personal computing, again.</span></div></header>
    <main id="playground" className="page-shell flex-1" hidden={page !== 'playground'}>
      <div className="intro flex items-end justify-between gap-4"><div><p className="eyebrow">INDEPENDENT SYSTEMS / EXPERIMENT 001</p><h1>Inference playground<span className="period">.</span></h1><p className="intro-description">A custom engine. A Go control plane. A place to try it.</p></div><span className="edition">WORK IN PROGRESS<br/>REVISION 0.1</span></div>
      <section className="mac-window" aria-label="Inference playground">
        <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2>inference — playground</h2><div className="title-lines" aria-hidden="true"/><span className="window-box small" aria-hidden="true"/></div>
        <div className="toolbar flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="mode-badge"><span className="status-square"/>{mock ? 'Sample mode' : 'Live API'}</span><span className="toolbar-note">{mock ? 'Authored responses · no model connected' : 'Custom inference endpoint'}</span></div><span className="mono text-xs">SESSION / 001</span></div>
        <div className="terminal">
          <form id="generation-form" onSubmit={event => { event.preventDefault(); void run() }}>
            <div className="terminal-banner"><p>Inference shell / v0.1</p><p>{mock ? "Sample session. No model connected." : "Live API endpoint configured."}</p></div><label className="shell-command" htmlFor="prompt"><span>yoon@inference</span>:~$ generate</label>
            <div className="prompt-line"><span aria-hidden="true">&gt;</span><textarea id="prompt" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void run() } }} disabled={busy} maxLength={16000} rows={3} placeholder="Ask the model something…" spellCheck={false}/></div>

          </form>
          <div className="response-section">
            <div className="shell-status" role="status" aria-live="polite">[{status.toLowerCase()}]{status === 'Ready' ? ' awaiting prompt' : status === 'Waiting' ? ' awaiting first token' : ''}</div>
            <div ref={outputRef} className="output" tabIndex={0} role="region" aria-label="Generated output" aria-busy={busy} onScroll={event => { const el = event.currentTarget; followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
              {output && <p className="response-text">{output}{busy && <span className="cursor" aria-hidden="true"/>}</p>}
              {!output && <p className="terminal-idle">{busy ? '' : '# Run a prompt to begin.'}<span className="cursor" aria-hidden="true"/></p>}
              {output && !busy && <p className="shell-command terminal-return"><span>yoon@inference</span>:~$ <span className="cursor" aria-hidden="true"/></p>}
            </div>
            {error && <p className="error-message" role="alert">{error}</p>}
          </div>
        </div>
        <section className="instrument-panel" aria-label="Generation controls and benchmarks">
          <div className="instrument-heading"><h3>Generation / benchmarks</h3><button className="copy-button" type="button" onClick={() => void copy()} disabled={!output || busy}>{copyStatus}</button></div>
            <div className="examples flex flex-wrap gap-2"><span>Try</span>{examples.map(example => <button key={example.label} type="button" disabled={busy} onClick={() => setPrompt(example.prompt)}>{example.label} <span aria-hidden="true">↗</span></button>)}</div>
            <div className="controls flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap items-center gap-5"><label>Max tokens <select value={maxTokens} onChange={event => setMaxTokens(Number(event.target.value))} disabled={busy || mock}><option>128</option><option>256</option><option>512</option><option>1024</option></select></label><label>Temperature <select value={temperature} onChange={event => setTemperature(Number(event.target.value))} disabled={busy || mock}><option>0</option><option>0.3</option><option>0.7</option><option>1</option></select></label></div>{busy ? <button type="button" className="generate" onClick={() => controller.current?.abort()}>Stop <span aria-hidden="true">■</span></button> : <button type="submit" form="generation-form" className="generate" disabled={!prompt.trim()}>Generate <span aria-hidden="true">↵</span></button>}</div>
        <div className="metrics" aria-label="Inference metrics"><Metric label="Time to first token" value={metrics.ttftMs} unit="ms" title="Engine-reported time to first token"/><Metric label="Decode throughput" value={metrics.decodeTokensPerSecond} unit="tok/s" title="Engine-reported decode throughput"/><Metric label="Output tokens" value={metrics.outputTokens} unit="tokens" title="Actual tokenizer count reported by the engine"/><Metric label="Total latency" value={metrics.totalLatencyMs === undefined ? undefined : metrics.totalLatencyMs / 1000} unit="s" title="Engine-reported total latency"/></div>
        </section>
        <div className="window-status"><span>{mock ? 'Sample mode. Generation settings apply to live requests only.' : 'POST /generate · JSON adapter'} </span><span className="resize-mark" aria-hidden="true">◩</span></div>
      </section>
      <div className="below-window flex flex-wrap justify-between gap-3"><p><span className="footnote-mark">↳</span> Built to understand what happens between prompt and token.</p><p className="mono">⌘ / Ctrl + Enter to generate</p></div>
    </main>
    <main className="page-shell about-page flex-1" hidden={page !== 'about'}>
      <div className="intro"><p className="eyebrow">A LITTLE CONTEXT</p><h1 id="about-heading" tabIndex={-1}>About me<span className="period">.</span></h1><p className="intro-description">The person behind the playground.</p></div>
      <section className="mac-window" aria-labelledby="about-title">
        <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2 id="about-title">yoon — readme.txt</h2><div className="title-lines" aria-hidden="true"/></div>
        <div className="about-content"><p className="sample-label">SAMPLE BIO / EDIT TO MAKE IT YOURS</p><h2>Hi, I’m Yoon.</h2><p>I’m building a custom inference platform: a Go control plane and an engine that turns prompts into tokens. This site is my working space for that project.</p><p>I’m interested in how systems behave under real constraints — fixed hardware, limited memory, and a latency budget. I like understanding where the time goes, then making the critical path faster.</p><div className="about-details"><section><h3>Currently building</h3><p>An inference engine and a small playground to make its behavior visible.</p></section><section><h3>Things I’m exploring</h3><p>Scheduling, KV cache management, GPU utilization, and honest performance measurement.</p></section></div><a className="about-link" href="#playground">Back to the playground <span aria-hidden="true">↗</span></a></div>
        <div className="window-status"><span>A short introduction. More to come.</span><span className="resize-mark" aria-hidden="true">◩</span></div>
      </section>
    </main>
    <footer className="page-footer"><span>Yoon <span className="footer-slash">/</span> Systems in progress</span><span>Small surface. Deep stack.</span></footer>
  </div>
}
