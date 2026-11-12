// The only OpenFinance routes this site may reach, shared by the production
// pass-through (api/of.ts) and the dev proxy (vite.config.ts) so both enforce
// the same list. Trading routes are here because the trade ticket places real
// orders with the visitor's own key. Withdrawals and transfers are NOT, so this
// page can never move funds out of an account, whatever its code asks for.
// (Underscore file: Vercel does not turn it into a function.)

const ROUTES: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^agent\/v1\/chat\/completions$/ }, // Jarvis AI
  { method: 'GET', path: /^agent\/chat\/credits$/ }, // AI credit balance (also proves the key)
  { method: 'GET', path: /^agent\/trading\/deposit-address$/ }, // the account's Hyperliquid address
  { method: 'GET', path: /^agent\/trading\/abstraction$/ }, // unified account check
  { method: 'POST', path: /^agent\/trading\/abstraction$/ }, // one-time unify (OpenFinance's own setup rule)
  { method: 'POST', path: /^agent\/trading\/leverage$/ },
  { method: 'POST', path: /^agent\/trading\/orders$/ },
  { method: 'DELETE', path: /^agent\/trading\/orders$/ }, // cancel
]

export function ofAllowed(method: string, path: string): boolean {
  return ROUTES.some((r) => r.method === method.toUpperCase() && r.path.test(path))
}

/** The OpenFinance path carried in `/api/of?path=...`. */
export function ofPathOf(url: string): string {
  return (new URL(url, 'http://local').searchParams.get('path') ?? '').replace(/^\/+/, '')
}
