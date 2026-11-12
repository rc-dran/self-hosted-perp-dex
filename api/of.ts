// Same-origin pass-through to api.openfinance.tech, for Jarvis' AI and the
// trade ticket. It forwards the visitor's own key from the request header and
// nothing else: no key is stored here and nothing is logged. Only the routes in
// _allow.ts get through (no withdrawals), so it cannot be used as an open proxy.
// Exists because api.openfinance.tech does not allow direct browser calls.

import { ofAllowed, ofPathOf } from './_allow'

export const config = { runtime: 'edge' }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export default async function handler(req: Request): Promise<Response> {
  const path = ofPathOf(req.url)
  if (!ofAllowed(req.method, path)) return json(404, { error: 'route not allowed' })

  const key = req.headers.get('x-api-key')
  if (!key) return json(401, { error: 'missing key' })

  const headers = new Headers({ 'x-api-key': key })
  const contentType = req.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)

  let upstream: Response
  try {
    upstream = await fetch(`https://api.openfinance.tech/${path}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' ? undefined : await req.text(),
    })
  } catch {
    return json(502, { error: 'upstream unreachable' })
  }
  // Stream the body straight back (chat completions are server-sent events).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  })
}
