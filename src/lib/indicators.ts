// Indicator math: RSI (Wilder) + pivot/divergence tags, EMA deviation bands
// ("Angelo bands": 30 EMA ± 2.5σ with top/bottom exhaustion signals), MACD.

import type { Candle } from './hyperliquid'

// ── shared helpers ──────────────────────────────────────────────

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  const k = 2 / (period + 1)
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rollingStd(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return out
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    sumSq += values[i] * values[i]
    if (i >= period) {
      sum -= values[i - period]
      sumSq -= values[i - period] * values[i - period]
    }
    if (i >= period - 1) {
      const mean = sum / period
      out[i] = Math.sqrt(Math.max(0, sumSq / period - mean * mean))
    }
  }
  return out
}

// ── RSI + divergences ───────────────────────────────────────────

export function computeRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length <= period) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  out[period] = rsiVal(avgGain, avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    out[i] = rsiVal(avgGain, avgLoss)
  }
  return out
}

function rsiVal(gain: number, loss: number): number {
  if (loss === 0) return 100
  return 100 - 100 / (1 + gain / loss)
}

export interface RsiTag {
  index: number
  kind: 'high' | 'low'
  label: 'PIVOT' | 'BULL' | 'BEAR'
}

/**
 * A pivot low/high is an RSI value strictly below/above every value within
 * `L` bars on both sides (so tags confirm `L` bars after the extreme).
 * Regular bullish divergence: price lower low + RSI higher low → BULL.
 * Regular bearish divergence: price higher high + RSI lower high → BEAR.
 */
export function findRsiTags(
  closes: number[],
  rsi: (number | null)[],
  L = 5,
  maxSpan = 60,
): RsiTag[] {
  const tags: RsiTag[] = []
  let prevLow = -1
  let prevHigh = -1
  for (let i = L; i < rsi.length - L; i++) {
    const v = rsi[i]
    if (v == null) continue
    let isHigh = true
    let isLow = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      const w = rsi[j]
      if (w == null) {
        isHigh = isLow = false
        break
      }
      if (w >= v) isHigh = false
      if (w <= v) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isLow) {
      let label: RsiTag['label'] = 'PIVOT'
      if (
        prevLow >= 0 &&
        i - prevLow <= maxSpan &&
        closes[i] < closes[prevLow] &&
        (rsi[i] as number) > (rsi[prevLow] as number)
      )
        label = 'BULL'
      // plain PIVOT tags only at meaningful extremes — keep the pane readable
      if (label === 'BULL' || v <= 40) tags.push({ index: i, kind: 'low', label })
      prevLow = i
    } else if (isHigh) {
      let label: RsiTag['label'] = 'PIVOT'
      if (
        prevHigh >= 0 &&
        i - prevHigh <= maxSpan &&
        closes[i] > closes[prevHigh] &&
        (rsi[i] as number) < (rsi[prevHigh] as number)
      )
        label = 'BEAR'
      if (label === 'BEAR' || v >= 60) tags.push({ index: i, kind: 'high', label })
      prevHigh = i
    }
  }
  return tags
}

// ── EMA deviation bands ("Angelo bands") ────────────────────────
// 30 EMA with ±2.5σ envelope (plus a dimmer ±1.5σ inner ribbon).
// Close beyond the outer band = top/bottom exhaustion signal:
// price stretched too far from balance — expect stall, mean-revert, or top/bottom.

export interface BandSignal {
  index: number
  kind: 'top' | 'bottom'
}

export interface EmaBands {
  mid: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
  innerUpper: (number | null)[]
  innerLower: (number | null)[]
  signals: BandSignal[]
}

export function emaBands(candles: Candle[], period = 30, mult = 2.5, innerMult = 1.5): EmaBands {
  const closes = candles.map((k) => k.c)
  const mid = ema(closes, period)
  const sd = rollingStd(closes, period)
  const n = closes.length
  const upper: (number | null)[] = new Array(n).fill(null)
  const lower: (number | null)[] = new Array(n).fill(null)
  const innerUpper: (number | null)[] = new Array(n).fill(null)
  const innerLower: (number | null)[] = new Array(n).fill(null)
  const signals: BandSignal[] = []
  for (let i = 0; i < n; i++) {
    const m = mid[i]
    const s = sd[i]
    if (m == null || s == null) continue
    upper[i] = m + mult * s
    lower[i] = m - mult * s
    innerUpper[i] = m + innerMult * s
    innerLower[i] = m - innerMult * s
    if (closes[i] > (upper[i] as number)) signals.push({ index: i, kind: 'top' })
    else if (closes[i] < (lower[i] as number)) signals.push({ index: i, kind: 'bottom' })
  }
  return { mid, upper, lower, innerUpper, innerLower, signals }
}

// ── Fibonacci retracement ───────────────────────────────────────
// Auto-anchored to the dominant swing of the lookback window.
// 0.618–0.65 is the "golden pocket" — it works through reflexivity
// (enough orders cluster there that it self-fulfills), not physics.

export const FIB_RATIOS = [0.382, 0.5, 0.618, 0.65, 0.786]

export interface FibResult {
  direction: 'up' | 'down' // direction of the impulse being retraced
  swingHigh: number
  swingLow: number
  levels: { ratio: number; px: number }[] // includes 0 and 1 endpoints
}

export function fibRetracement(candles: Candle[], lookback = 250): FibResult | null {
  const ks = candles.slice(-lookback)
  if (ks.length < 20) return null
  let hiIdx = 0
  let loIdx = 0
  for (let i = 1; i < ks.length; i++) {
    if (ks[i].h > ks[hiIdx].h) hiIdx = i
    if (ks[i].l < ks[loIdx].l) loIdx = i
  }
  const high = ks[hiIdx].h
  const low = ks[loIdx].l
  if (high <= low) return null
  const direction: 'up' | 'down' = hiIdx >= loIdx ? 'up' : 'down'
  const range = high - low
  const levels = [0, ...FIB_RATIOS, 1].map((r) => ({
    ratio: r,
    px: direction === 'up' ? high - r * range : low + r * range,
  }))
  return { direction, swingHigh: high, swingLow: low, levels }
}

// ── MACD ────────────────────────────────────────────────────────

export interface Macd {
  macd: (number | null)[]
  signal: (number | null)[]
  hist: (number | null)[]
}

export function macdCalc(closes: number[], fast = 12, slow = 26, sigPeriod = 9): Macd {
  const ef = ema(closes, fast)
  const es = ema(closes, slow)
  const macd = closes.map((_, i) =>
    ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null,
  )
  const start = macd.findIndex((v) => v != null)
  const signal: (number | null)[] = new Array(closes.length).fill(null)
  if (start >= 0) {
    const sig = ema(macd.slice(start) as number[], sigPeriod)
    for (let i = start; i < closes.length; i++) signal[i] = sig[i - start]
  }
  const hist = macd.map((v, i) =>
    v != null && signal[i] != null ? v - (signal[i] as number) : null,
  )
  return { macd, signal, hist }
}
