// One way to call OpenFinance from the browser: through the same-origin
// pass-through /api/of?path=..., with the visitor's key from this tab.

import { getOfKey } from './ofkey'

export class OfError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function ofCall(path: string, init: RequestInit = {}): Promise<Response> {
  const key = getOfKey()
  if (!key) return Promise.reject(new OfError('Add your OpenFinance key first.', 0))
  return fetch(`/api/of?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'x-api-key': key },
  })
}
