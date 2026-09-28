interface Env {
  DEMO_KEY: string
  ORIGIN_URL: string // e.g. http://yoon-relay.duckdns.org:8080
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body = await request.text()
  if (body.length > 8192) return new Response('request too large', { status: 413 })

  try {
    const upstream = await fetch(`${env.ORIGIN_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Key': env.DEMO_KEY },
      body,
      signal: AbortSignal.timeout(50_000),
    })
    const headers = new Headers({ 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain' })
    const retry = upstream.headers.get('Retry-After')
    if (retry) headers.set('Retry-After', retry)
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return new Response('demo offline', { status: 503 })
  }
}