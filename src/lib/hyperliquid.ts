// Direct-to-Hyperliquid market data: REST snapshot + public WebSocket.

export const HL_INFO = 'https://api.hyperliquid.xyz/info'
export const HL_WS = 'wss://api.hyperliquid.xyz/ws'

export interface Candle {
  t: number // open time, ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface AssetCtx {
  markPx: number
  oraclePx: number
  midPx: number
  prevDayPx: number
  dayNtlVlm: number
  openInterest: number
  funding: number
}

export const INTERVALS = [
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '8h', '12h',
  '1d', '3d', '1w', '1M',
] as const
export type Interval = (typeof INTERVALS)[number]

export const INTERVAL_LABEL: Record<Interval, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '8h': '8h', '12h': '12h',
  '1d': 'D', '3d': '3D', '1w': 'W', '1M': 'M',
}

const H = 3_600_000
const D = 86_400_000
const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': H, '2h': 2 * H, '4h': 4 * H, '8h': 8 * H, '12h': 12 * H,
  '1d': D, '3d': 3 * D, '1w': 7 * D, '1M': 30 * D,
}

export async function hlInfo<T = any>(body: unknown): Promise<T> {
  const res = await fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HL info ${res.status}`)
  return res.json()
}

/** Best bid and ask right now (works for HIP-3 names like 'xyz:NVDA'). */
export async function fetchTopOfBook(coin: string): Promise<{ bid: number; ask: number }> {
  const book = await hlInfo<any>({ type: 'l2Book', coin })
  const bid = parseFloat(book?.levels?.[0]?.[0]?.px ?? 'NaN')
  const ask = parseFloat(book?.levels?.[1]?.[0]?.px ?? 'NaN')
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error('empty order book')
  return { bid, ask }
}

export async function fetchCandles(coin: string, interval: Interval, count = 600): Promise<Candle[]> {
  const endTime = Date.now()
  const startTime = endTime - INTERVAL_MS[interval] * count
  const raw = await hlInfo<any[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  })
  return raw.map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }))
}

export function parseCtx(raw: any): AssetCtx {
  return {
    markPx: +raw.markPx,
    oraclePx: +(raw.oraclePx ?? raw.markPx),
    midPx: +(raw.midPx ?? raw.markPx),
    prevDayPx: +raw.prevDayPx,
    dayNtlVlm: +raw.dayNtlVlm,
    openInterest: +(raw.openInterest ?? 0),
    funding: +(raw.funding ?? 0),
  }
}

type Sub = Record<string, string>

/** Minimal Hyperliquid WS client: auto-reconnect, resubscribe, keepalive ping. */
export class HLSocket {
  private ws: WebSocket | null = null
  private subs: Sub[] = []
  private handlers = new Set<(channel: string, data: any) => void>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  connect() {
    if (this.disposed) return
    this.ws = new WebSocket(HL_WS)
    this.ws.onopen = () => {
      for (const sub of this.subs) this.send({ method: 'subscribe', subscription: sub })
      this.pingTimer = setInterval(() => this.send({ method: 'ping' }), 30_000)
    }
    this.ws.onmessage = (ev) => {
      let msg: any
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.channel && msg.channel !== 'pong') {
        for (const h of this.handlers) h(msg.channel, msg.data)
      }
    }
    this.ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      if (!this.disposed) this.reconnectTimer = setTimeout(() => this.connect(), 1500)
    }
    this.ws.onerror = () => this.ws?.close()
  }

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  subscribe(sub: Sub) {
    this.subs.push(sub)
    this.send({ method: 'subscribe', subscription: sub })
  }

  unsubscribe(sub: Sub) {
    this.subs = this.subs.filter((s) => JSON.stringify(s) !== JSON.stringify(sub))
    this.send({ method: 'unsubscribe', subscription: sub })
  }

  onMessage(h: (channel: string, data: any) => void) {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }

  dispose() {
    this.disposed = true
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}

/** Round a size DOWN to szDecimals (backend does not re-round). */
export function roundSz(sz: number, szDecimals: number): string {
  const f = 10 ** szDecimals
  const v = Math.floor(sz * f + 1e-9) / f // epsilon: 0.00015 * 1e5 is 14.999… in floating point
  return v.toFixed(szDecimals).replace(/\.?0+$/, '') || '0'
}

/** Hyperliquid perp px rule: max 5 significant figures AND max (6 - szDecimals) decimals. */
export function roundPx(px: number, szDecimals: number): string {
  if (px >= 100_000) return String(Math.round(px)) // integers are always allowed
  const maxDecimals = Math.max(0, 6 - szDecimals)
  const sig = Number(px.toPrecision(5))
  const v = Number(sig.toFixed(maxDecimals))
  return String(v)
}

export function fmtUsd(n: number, digits = 2): string {
  if (!isFinite(n)) return '–'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(digits)}`
}

export function fmtPx(n: number): string {
  if (!isFinite(n)) return '–'
  return n.toLocaleString('en-US', {
    maximumFractionDigits: n >= 1000 ? 1 : n >= 1 ? 4 : 6,
  })
}
