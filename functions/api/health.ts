interface Env { ORIGIN_URL: string }

export const onRequestGet = async ({ env }: { env: Env }) => {
  if (!env.ORIGIN_URL) return new Response('engine connection not configured', { status: 503 })
  try {
    const upstream = await fetch(`${env.ORIGIN_URL.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!upstream.ok) return new Response('engine status unavailable', { status: upstream.status })
    const body = await upstream.json() as { state?: unknown }
    // Do not expose internal provider errors through the public status endpoint.
    return Response.json({ state: body.state }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return new Response('engine status unavailable', { status: 503 })
  }
}
