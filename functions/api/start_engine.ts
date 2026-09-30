interface Env { DEMO_KEY: string; ORIGIN_URL: string }

export const onRequestPost = async ({ env }: { env: Env }) => {
  if (!env.ORIGIN_URL || !env.DEMO_KEY) return new Response('engine connection not configured', { status: 503 })
  try {
    const upstream = await fetch(`${env.ORIGIN_URL.replace(/\/+$/, '')}/start_engine`, {
      method: 'POST', headers: { 'X-Demo-Key': env.DEMO_KEY }, signal: AbortSignal.timeout(50_000),
    })
    const body = await upstream.text()
    const headers = new Headers({ 'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain', 'Cache-Control': 'no-store' })
    const retry = upstream.headers.get('Retry-After')
    if (retry) headers.set('Retry-After', retry)
    return new Response(body, { status: upstream.status, headers })
  } catch {
    return new Response('start request could not be confirmed; check engine status', { status: 503 })
  }
}
