// Trading through OpenFinance with the visitor's own key (from this tab), via
// the same-origin pass-through. Account, order and fill reads go straight to
// Hyperliquid's public info API, keyed by the account's Hyperliquid address.
// The pass-through only allows the routes in api/_allow.ts: no withdrawals.

import { hlInfo } from './hyperliquid'
import { getOfKey } from './ofkey'
import { OfError, ofCall } from './ofapi'

const TRADING = 'agent/trading'

/** Hyperliquid's rejection reasons, said plainly. Unknown ones pass through,
    trimmed of codes, so the user still learns what happened. */
export function plainReject(raw: string): string {
  const m = raw.trim()
  if (/insufficient margin|not enough margin|insufficient collateral/i.test(m)) return 'Not enough balance for this order. Lower the size or the leverage.'
  if (/minimum value/i.test(m)) return 'Orders must be worth at least $10. Increase the size.'
  if (/could not immediately match/i.test(m)) return 'Nothing filled within 1% of the market price, so no trade happened. Try again.'
  if (/tick size|divisible/i.test(m)) return "That price isn't a valid step for this market. Round the TP or SL price and try again."
  if (/reduce only.*increase|would increase position/i.test(m)) return 'Reduce Only can only shrink a position, and this order would grow it. Untick Reduce Only or switch side.'
  if (/switch leverage type|open position/i.test(m) && /leverage|margin/i.test(m)) return "You have an open position in this market, so its margin mode can't change. Keep the current Cross/Isolated setting, or close the position first."
  if (/leverage/i.test(m)) return "This market doesn't allow that leverage or margin mode. Lower the leverage or switch Cross/Isolated."
  if (/price too far|out of bounds|oracle|away from the reference/i.test(m)) return 'The price moved too far from the market. Try again.'
  if (/rate limit|too many/i.test(m)) return 'Too many requests right now. Wait a few seconds and try again.'
  const clean = m.replace(/\s*asset=\d+/g, '').replace(/[{}"[\]]/g, '').slice(0, 160)
  return `Hyperliquid rejected this: ${clean}`
}

async function ofJson(path: string, init: RequestInit = {}): Promise<any> {
  let res: Response
  try {
    res = await ofCall(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    })
  } catch (e) {
    if (e instanceof OfError) throw e
    throw new OfError("Couldn't reach OpenFinance just now. Check your internet connection and try again.", 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new OfError("OpenFinance didn't accept your key. Add it again with the key button (top right).", res.status)
    }
    if (res.status === 502 || res.status === 503 || res.status === 504 || body?.error === 'upstream unreachable') {
      throw new OfError("Couldn't reach OpenFinance just now. Check your internet connection and try again.", res.status)
    }
    if (res.status === 429) throw new OfError('Too many requests right now. Wait a few seconds and try again.', res.status)
    // a Hyperliquid reason buried in the response, if there is one
    const inner = body?.insufficientCollateral?.[0]?.message ?? body?.error?.response ?? body?.error?.message ?? (typeof body?.error === 'string' ? body.error : null)
    if (typeof inner === 'string' && inner) throw new OfError(plainReject(inner), res.status)
    throw new OfError("OpenFinance couldn't do that right now. Try again in a moment.", res.status)
  }
  return body
}

let cached: { key: string; address: string } | null = null

/** The account's Hyperliquid address (where USDC deposits go). Cached per key. */
export async function getWalletAddress(): Promise<string> {
  const key = getOfKey()
  if (cached && cached.key === key) return cached.address
  const r = await ofJson(`${TRADING}/deposit-address`)
  const address = r?.data?.address
  if (!address) throw new OfError("This OpenFinance account doesn't have a Hyperliquid wallet yet. Set one up on openfinance.tech.", 0)
  cached = { key, address }
  return address
}

export interface Position {
  coin: string // dex-prefixed for HIP-3 ('xyz:MU'), plain native ('BTC')
  szi: number // signed size, base units
  entryPx: number
  positionValue: number
  unrealizedPnl: number
  liquidationPx: number | null
  leverage: number | null
  isCross: boolean
  dex: string
}

export interface SpotBalance {
  coin: string
  total: number
  hold: number
}

/* How Hyperliquid accounts hold money (checked against Hyperliquid's own
   portfolio figure on a live unified account, 2026-11-11):
   - unified (and portfolio margin): ONE pool. The spot USDC balance is the whole
     account, open profit and loss included; perp margin shows as its "hold".
     The perp side only mirrors that same money, so it must NOT be added on top.
   - default: two pools. Perp account value and spot USDC are separate money, and
     only the perp side (its withdrawable part) can back new perp orders. */
/** Money backing perp orders on one dex ('' = the main Hyperliquid dex). */
export interface DexMargin {
  /** equity that can be lost before liquidation (cross) */
  equity: number
  /** free to back new orders */
  available: number
  /** maintenance margin already used by cross positions */
  maintenance: number
}

export interface AccountState {
  unified: boolean
  /** per dex: in unified mode every dex draws on the one pool */
  byDex: Record<string, DexMargin>
  /** total account value: what "Balance" shows */
  equity: number
  /** free to back new orders */
  available: number
  /** cross maintenance margin already in use (for liquidation estimates) */
  maintenance: number
  marginUsed: number
  unrealizedPnl: number
  positions: Position[]
  balances: SpotBalance[]
}

const modeCache = new Map<string, { unified: boolean; at: number }>()

/** Account mode, cached for a minute (it only changes when the account is unified). */
async function isUnified(address: string): Promise<boolean> {
  const hit = modeCache.get(address)
  if (hit && Date.now() - hit.at < 60_000) return hit.unified
  const mode = await hlInfo<string>({ type: 'userAbstraction', user: address })
  const unified = mode === 'unifiedAccount' || mode === 'portfolioMargin'
  modeCache.set(address, { unified, at: Date.now() })
  return unified
}

function parsePositions(ch: any, dex: string): Position[] {
  return (ch?.assetPositions ?? [])
    .map((entry: any) => {
      const p = entry.position ?? entry
      const lev = p.leverage
      let coin = p.coin ?? ''
      if (dex && coin && !coin.includes(':')) coin = `${dex}:${coin}`
      return {
        coin,
        szi: parseFloat(p.szi ?? '0'),
        entryPx: parseFloat(p.entryPx ?? '0'),
        positionValue: parseFloat(p.positionValue ?? '0'),
        unrealizedPnl: parseFloat(p.unrealizedPnl ?? '0'),
        liquidationPx: p.liquidationPx != null ? parseFloat(p.liquidationPx) : null,
        leverage: typeof lev === 'object' ? (lev?.value ?? null) : (lev ?? null),
        isCross: typeof lev === 'object' ? lev?.type !== 'isolated' : true,
        dex,
      }
    })
    .filter((p: Position) => p.szi !== 0)
}

/** Native clearinghouse + spot; plus the selected asset's HIP-3 dex if any. */
const dexCache = new Map<string, { at: number; state: any }>()

/** A HIP-3 dex's perp state. The selected market's dex is read every time;
    other dexes (to show their positions) at most every 20 seconds. */
async function dexState(address: string, dex: string, fresh: boolean): Promise<any> {
  const k = `${address}|${dex}`
  const hit = dexCache.get(k)
  if (!fresh && hit && Date.now() - hit.at < 20_000) return hit.state
  try {
    const state = await hlInfo<any>({ type: 'clearinghouseState', user: address, dex })
    dexCache.set(k, { at: Date.now(), state })
    return state
  } catch (e) {
    if (fresh) throw e // the market on screen must be current
    return hit?.state ?? null
  }
}

/** Account state across the main dex and every HIP-3 dex in `dexes`;
    `dex` is the selected market's dex, always read fresh. */
export async function getAccount(dex?: string, dexes: string[] = []): Promise<AccountState> {
  const address = await getWalletAddress()
  const allDexes = [...new Set([...(dex ? [dex] : []), ...dexes])]
  const [ch, spot, unified, ...dexStates] = await Promise.all([
    hlInfo<any>({ type: 'clearinghouseState', user: address }),
    hlInfo<any>({ type: 'spotClearinghouseState', user: address }),
    isUnified(address),
    ...allDexes.map((d) => dexState(address, d, d === dex)),
  ])
  const withdrawable = parseFloat(ch?.withdrawable ?? '0')
  const balances: SpotBalance[] = (spot?.balances ?? []).map((b: any) => ({
    coin: b.coin,
    total: parseFloat(b.total ?? '0'),
    hold: parseFloat(b.hold ?? '0'),
  }))
  const usdc = balances.find((b) => b.coin === 'USDC')
  const spotTotal = usdc?.total ?? 0
  const spotHold = usdc?.hold ?? 0
  const perpValue = parseFloat(ch?.marginSummary?.accountValue ?? '0')
  const num = (v: any) => parseFloat(v ?? '0') || 0
  const positions = [...parsePositions(ch, ''), ...allDexes.flatMap((d, i) => parsePositions(dexStates[i], d))]
  const equity = unified ? spotTotal : perpValue + spotTotal
  const available = unified ? Math.max(0, spotTotal - spotHold) : withdrawable
  const maintenance = num(ch?.crossMaintenanceMarginUsed) + dexStates.reduce((s, st) => s + num(st?.crossMaintenanceMarginUsed), 0)
  // default mode: each dex is its own pool and spot USDC backs none of them
  const byDex: Record<string, DexMargin> = unified
    ? Object.fromEntries(['', ...allDexes].map((d) => [d, { equity, available, maintenance }]))
    : {
        '': { equity: perpValue, available: withdrawable, maintenance: num(ch?.crossMaintenanceMarginUsed) },
        ...Object.fromEntries(
          allDexes.map((d, i) => [
            d,
            {
              equity: num(dexStates[i]?.marginSummary?.accountValue),
              available: num(dexStates[i]?.withdrawable),
              maintenance: num(dexStates[i]?.crossMaintenanceMarginUsed),
            },
          ]),
        ),
      }
  return {
    unified,
    byDex,
    equity,
    available,
    maintenance,
    marginUsed: parseFloat(ch?.marginSummary?.totalMarginUsed ?? '0'),
    unrealizedPnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
    positions,
    balances,
  }
}

export interface OpenOrder {
  coin: string
  isBuy: boolean
  limitPx: number
  sz: number
  origSz: number
  oid: number
  timestamp: number
  orderType: string
  dex: string
}

export async function getOpenOrders(dex?: string): Promise<OpenOrder[]> {
  const address = await getWalletAddress()
  const [native, onDex] = await Promise.all([
    hlInfo<any[]>({ type: 'frontendOpenOrders', user: address }).catch(() => []),
    dex
      ? hlInfo<any[]>({ type: 'frontendOpenOrders', user: address, dex }).catch(() => [])
      : Promise.resolve([]),
  ])
  const map = (arr: any[], d: string): OpenOrder[] =>
    (arr ?? []).map((o: any) => ({
      coin: d && !String(o.coin).includes(':') ? `${d}:${o.coin}` : o.coin,
      isBuy: o.side === 'B',
      limitPx: parseFloat(o.limitPx ?? '0'),
      sz: parseFloat(o.sz ?? '0'),
      origSz: parseFloat(o.origSz ?? o.sz ?? '0'),
      oid: o.oid,
      timestamp: o.timestamp,
      orderType: o.orderType ?? 'Limit',
      dex: d,
    }))
  return [...map(native, ''), ...map(onDex ?? [], dex ?? '')]
}

export interface Fill {
  coin: string
  isBuy: boolean
  px: number
  sz: number
  time: number
  closedPnl: number
  fee: number
  dir: string
}

export async function getFills(): Promise<Fill[]> {
  const address = await getWalletAddress()
  const raw = await hlInfo<any[]>({ type: 'userFills', user: address }).catch(() => [])
  return (raw ?? []).slice(0, 60).map((f: any) => ({
    coin: f.coin,
    isBuy: f.side === 'B',
    px: parseFloat(f.px ?? '0'),
    sz: parseFloat(f.sz ?? '0'),
    time: f.time,
    closedPnl: parseFloat(f.closedPnl ?? '0'),
    fee: parseFloat(f.fee ?? '0'),
    dir: f.dir ?? '',
  }))
}

/** Resolves when Hyperliquid confirms the cancel; throws a plain reason otherwise. */
export async function cancelOrder(assetIndex: number, oid: number): Promise<void> {
  const r = await ofJson(`${TRADING}/orders`, {
    method: 'DELETE',
    body: JSON.stringify({ cancels: [{ a: assetIndex, o: oid }] }),
  })
  if (r?.status === 'err') throw new OfError(plainReject(String(r.response ?? 'Cancel rejected')), 400)
  const st = (r?.response?.data?.statuses ?? r?.data?.statuses ?? r?.statuses ?? [])[0]
  if (st === 'success') return
  if (st?.error) {
    throw new OfError(
      /never placed|already canceled|filled/i.test(String(st.error))
        ? 'That order is no longer open: it already filled or was cancelled.'
        : plainReject(String(st.error)),
      400,
    )
  }
  throw new OfError("OpenFinance didn't confirm the cancel. Check Open Orders.", 0)
}

/** One-shot idempotent upgrade to unifiedAccount (OpenFinance's auto-unify rule). */
export async function ensureUnified(state: AccountState): Promise<boolean> {
  if (state.unified || state.equity <= 0) return false
  try {
    const ab = await ofJson(`${TRADING}/abstraction`)
    const mode = typeof ab === 'string' ? ab : (ab?.abstraction ?? ab?.userAbstraction ?? ab?.data)
    if (mode === 'default' || mode === 'disabled') {
      await ofJson(`${TRADING}/abstraction`, {
        method: 'POST',
        body: JSON.stringify({ abstraction: 'u' }),
      })
      modeCache.clear() // read the new mode on the next refresh
      return true
    }
  } catch {
    // backend hiccup: not fatal for trading, skip silently
  }
  return false
}

/** Leverage and margin mode for an asset; applied before each order. */
export async function setLeverage(assetIndex: number, isCross: boolean, leverage: number): Promise<void> {
  const r = await ofJson(`${TRADING}/leverage`, {
    method: 'POST',
    body: JSON.stringify({ asset: assetIndex, isCross, leverage }),
  })
  // Hyperliquid's own rejections come back inside a 200 response
  if (r?.status === 'err') throw new OfError(plainReject(String(r.response ?? 'Leverage change rejected')), 400)
  if (r?.success === false) throw new OfError(plainReject(String(r.message ?? r.error ?? 'Leverage change rejected')), 400)
}

export type Tif = 'Ioc' | 'Gtc' | 'FrontendMarket'

export interface RawOrder {
  a: number
  b: boolean
  p: string
  s: string
  r: boolean
  t: { limit: { tif: Tif } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } }
}

export interface OrderResult {
  status: 'filled' | 'resting' | 'error'
  totalSz?: string
  avgPx?: string
  oid?: number
  error?: string
  /** attached TP/SL legs that Hyperliquid rejected (empty when all were accepted) */
  rejectedLegs?: { kind: 'TP' | 'SL'; reason: string }[]
}

export async function placeOrders(
  orders: RawOrder[],
  grouping: 'na' | 'normalTpsl' = 'na',
): Promise<OrderResult> {
  const resp = await ofJson(`${TRADING}/orders`, {
    method: 'POST',
    body: JSON.stringify({ orders, grouping }),
  })
  if (resp?.status === 'err') return { status: 'error', error: plainReject(String(resp.response ?? 'Order rejected')) }
  const statuses =
    resp?.response?.data?.statuses ?? resp?.data?.statuses ?? resp?.statuses ?? []
  const st = statuses[0]
  if (!st) return { status: 'error', error: "OpenFinance didn't confirm the order. Check Positions and Open Orders before trying again." }
  // TP/SL legs follow the main order; a leg is fine when it waits or rests
  const rejectedLegs = orders.slice(1).flatMap((o, i) => {
    const leg = statuses[i + 1]
    const kind: 'TP' | 'SL' = 'trigger' in o.t && o.t.trigger.tpsl === 'tp' ? 'TP' : 'SL'
    const ok = leg === 'waitingForFill' || leg === 'waitingForTrigger' || leg?.resting || leg?.filled
    return ok ? [] : [{ kind, reason: leg?.error ? plainReject(String(leg.error)) : 'Hyperliquid did not confirm it.' }]
  })
  if (st.filled) return { status: 'filled', ...st.filled, rejectedLegs }
  if (st.resting) return { status: 'resting', oid: st.resting.oid, rejectedLegs }
  if (st.error) return { status: 'error', error: plainReject(String(st.error)) }
  return { status: 'error', error: "OpenFinance didn't confirm the order. Check Positions and Open Orders before trying again." }
}
