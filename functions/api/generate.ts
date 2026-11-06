interface Env {
  DEMO_KEY: string
  ORIGIN_URL: string
}

// Go's generation budget is 180s; the browser allows 190s for a terminal event.
export const PROXY_TIMEOUT_MS = 185_000

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > 8192) return new Response('request too large', { status: 413 })
  const deadline = AbortSignal.timeout(PROXY_TIMEOUT_MS)
  try {
    const upstream = await fetch(`${env.ORIGIN_URL.replace(/\/+$/, '')}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Key': env.DEMO_KEY },
      body,
      signal: AbortSignal.any([request.signal, deadline]),
    })
    const headers = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    })
    if (upstream.headers.get('X-Relay-Rejection') === 'engine_capacity') headers.set('X-Relay-Rejection', 'engine_capacity')
    const retry = upstream.headers.get('Retry-After')
    if (retry) headers.set('Retry-After', retry)
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return new Response(deadline.aborted ? 'generation timed out' : 'demo offline', {
      status: deadline.aborted ? 504 : 503,
    })
  }
}
