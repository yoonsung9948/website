import { sanitizeEngineInfo } from '../../../src/lib/engine-info'
interface Env { ORIGIN_URL: string; DEMO_KEY: string }
export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.ORIGIN_URL || !env.DEMO_KEY) return Response.json({ error: 'engine_info_unavailable' }, { status: 503 })
  try {
    const upstream = await fetch(`${env.ORIGIN_URL.replace(/\/+$/, '')}/engine/info`, {
      headers: { 'X-Demo-Key': env.DEMO_KEY }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]), cache: 'no-store',
    })
    if (!upstream.ok) throw new Error('unavailable')
    return Response.json(sanitizeEngineInfo(await upstream.json()), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'engine_info_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
