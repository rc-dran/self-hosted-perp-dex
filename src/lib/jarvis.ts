// Jarvis: the indicator copilot. Two engines:
//  - built-in: deterministic analysis of live indicator state (free, instant,
//    always available, and the only engine used for filter-toggle narration);
//  - AI: when the visitor adds their OpenFinance key, questions go to a real
//    LLM through OpenFinance (see lib/llm.ts) with this same live context and
//    the built-in read embedded, so its numbers come from the chart.

import type { Candle } from './hyperliquid'
import { fmtPx } from './hyperliquid'
import { computeRSI, findRsiTags, emaBands, macdCalc, fibRetracement } from './indicators'
import { tradeZones } from './zones'
import type { ChatMsg } from './llm'
import type { IndicatorSel } from '../components/Chart'

export interface JarvisContext {
  sym: string
  interval: string
  price: number
  sel: IndicatorSel
  bands: {
    mid: number
    upper: number
    lower: number
    pctFromMid: number // % distance of price from the 30 EMA
    zone: 'above-upper' | 'upper-half' | 'lower-half' | 'below-lower'
    lastSignal: { kind: 'top' | 'bottom'; barsAgo: number } | null
  } | null
  rsi: {
    value: number
    zone: 'overbought' | 'bullish' | 'bearish' | 'oversold'
    lastDivergence: { kind: 'BULL' | 'BEAR'; barsAgo: number } | null
  } | null
  macd: {
    hist: number
    rising: boolean
    aboveSignal: boolean
    aboveZero: boolean
    crossedBarsAgo: number | null
  } | null
  fib: {
    direction: 'up' | 'down'
    swingHigh: number
    swingLow: number
    nearest: { ratio: number; px: number; distPct: number }
    inGoldenPocket: boolean
  } | null
  zones: {
    buy: { top: number; bottom: number; distPct: number; inside: boolean } | null
    sell: { top: number; bottom: number; distPct: number; inside: boolean } | null
  } | null
}

export function buildContext(
  sym: string,
  interval: string,
  candles: Candle[],
  sel: IndicatorSel,
): JarvisContext | null {
  if (!candles.length) return null
  const closes = candles.map((k) => k.c)
  const n = closes.length
  const price = closes[n - 1]
  const ctx: JarvisContext = {
    sym,
    interval,
    price,
    sel,
    bands: null,
    rsi: null,
    macd: null,
    fib: null,
    zones: null,
  }

  const b = emaBands(candles)
  const mid = b.mid[n - 1]
  const upper = b.upper[n - 1]
  const lower = b.lower[n - 1]
  if (mid != null && upper != null && lower != null) {
    const last = b.signals.length ? b.signals[b.signals.length - 1] : null
    ctx.bands = {
      mid,
      upper,
      lower,
      pctFromMid: ((price - mid) / mid) * 100,
      zone:
        price > upper
          ? 'above-upper'
          : price < lower
            ? 'below-lower'
            : price >= mid
              ? 'upper-half'
              : 'lower-half',
      lastSignal: last ? { kind: last.kind, barsAgo: n - 1 - last.index } : null,
    }
  }

  const rsi = computeRSI(closes)
  const rv = rsi[n - 1]
  if (rv != null) {
    const tags = findRsiTags(closes, rsi).filter((t) => t.label !== 'PIVOT')
    const lastDiv = tags.length ? tags[tags.length - 1] : null
    ctx.rsi = {
      value: rv,
      zone: rv >= 70 ? 'overbought' : rv >= 50 ? 'bullish' : rv > 30 ? 'bearish' : 'oversold',
      lastDivergence: lastDiv
        ? { kind: lastDiv.label as 'BULL' | 'BEAR', barsAgo: n - 1 - lastDiv.index }
        : null,
    }
  }

  const m = macdCalc(closes)
  const h = m.hist[n - 1]
  const hPrev = m.hist[n - 2]
  const line = m.macd[n - 1]
  const sig = m.signal[n - 1]
  if (h != null && line != null && sig != null) {
    let crossedBarsAgo: number | null = null
    for (let i = n - 1; i > Math.max(0, n - 15); i--) {
      const a = m.hist[i]
      const p = m.hist[i - 1]
      if (a != null && p != null && Math.sign(a) !== Math.sign(p)) {
        crossedBarsAgo = n - 1 - i
        break
      }
    }
    ctx.macd = {
      hist: h,
      rising: hPrev != null ? h >= hPrev : true,
      aboveSignal: line >= sig,
      aboveZero: line >= 0,
      crossedBarsAgo,
    }
  }

  const fib = fibRetracement(candles)
  if (fib) {
    const ratios = fib.levels.filter((l) => l.ratio > 0 && l.ratio < 1)
    let nearest = ratios[0]
    for (const l of ratios)
      if (Math.abs(l.px - price) < Math.abs(nearest.px - price)) nearest = l
    const gp1 = fib.levels.find((l) => l.ratio === 0.618)!.px
    const gp2 = fib.levels.find((l) => l.ratio === 0.65)!.px
    const [lo, hi] = gp1 < gp2 ? [gp1, gp2] : [gp2, gp1]
    ctx.fib = {
      direction: fib.direction,
      swingHigh: fib.swingHigh,
      swingLow: fib.swingLow,
      nearest: { ratio: nearest.ratio, px: nearest.px, distPct: (Math.abs(price - nearest.px) / price) * 100 },
      inGoldenPocket: price >= lo && price <= hi,
    }
  }

  const zs = tradeZones(candles)
  const zoneInfo = (kind: 'buy' | 'sell') => {
    const z = zs.find((x) => x.kind === kind)
    if (!z) return null
    const inside = price >= z.bottom && price <= z.top
    const edge = kind === 'buy' ? z.top : z.bottom
    return { top: z.top, bottom: z.bottom, distPct: inside ? 0 : (Math.abs(price - edge) / price) * 100, inside }
  }
  ctx.zones = { buy: zoneInfo('buy'), sell: zoneInfo('sell') }

  return ctx
}

// ── canned explainers (used when a filter is toggled or asked about) ──

export const EXPLAINERS: Record<
  keyof IndicatorSel,
  { name: string; text: string; how: string[] }
> = {
  bands: {
    name: 'EMA Bands (30 EMA ± 2.5σ)',
    text:
      'A 30-period EMA with an envelope 2.5 standard deviations either side, plus a dimmer 1.5σ inner ribbon. The blue mid line is "balance"; the envelope is how far price normally strays from it. When a candle CLOSES beyond the outer band a dot prints on the chart: red above = top signal, green below = bottom signal. It is a mean-reversion warning, not an automatic entry.',
    how: [
      'Trend-follow while price rides between the mid line and the outer band; the 30 EMA is your balance line.',
      'A dot beyond ±2.5σ = exhaustion. Three usual outcomes: price stalls and the band catches up, price corrects back to the band, or that was the top/bottom of the move.',
      'Never chase an entry INTO a dot. Wait for the pullback toward the band/mid, or fade the extreme with tight invalidation.',
      'Signals on higher timeframes (4h, D) carry far more weight than 1m/5m noise.',
    ],
  },
  rsi: {
    name: 'RSI(14) + divergences',
    text:
      'Momentum oscillator from 0 to 100 measuring the speed of recent price changes. Above 70 = overbought, below 30 = oversold. The engine also marks swing pivots (dots at extremes) and hunts regular divergences between consecutive pivots, the strongest tell this panel produces.',
    how: [
      'Above 70 / below 30 alone is NOT a signal; in strong trends RSI stays pinned for a long time.',
      'BULL tag = price made a lower low while RSI made a higher low: downside momentum is exhausting.',
      'BEAR tag = price higher high + RSI lower high: the rally is losing fuel.',
      'A divergence landing on the same bars as a band exhaustion dot is the highest-conviction combo here.',
    ],
  },
  fib: {
    name: 'Fibonacci Retracements',
    text:
      'Horizontal levels at 0.382, 0.5, 0.618, 0.65 and 0.786 of the dominant swing (auto-anchored to the biggest high-to-low move of the last ~250 bars). The 0.618-0.65 zone is the "golden pocket" - the most crowded pullback-entry zone in crypto. There is no physical reason it works, only reflexivity: enough people place orders there that it functions.',
    how: [
      'Anchored automatically: "anchor" line = start of the swing, "swing" line = its end; ratios measure how deep the pullback has retraced.',
      '0.382 / 0.5 = shallow pullbacks that hold in strong trends; 0.786 = deep, last-chance zone before the swing is considered failed.',
      'The gold lines are the golden pocket (0.618-0.65): the classic crypto bid zone on a pullback in an uptrend, or the fade zone on a bounce in a downtrend.',
      'Levels alone are self-fulfilling magnets, not magic - a golden-pocket touch WITH an RSI divergence or a band exhaustion dot is the real signal.',
    ],
  },
  zones: {
    name: 'Buy / Sell Areas',
    text:
      'Auto-detected supply and demand zones. The engine finds the nearest untested swing pivots: the last pivot low below price (demand → BUY AREA, green) and the last pivot high above price (supply → SELL AREA, red), and sizes each zone by ATR so it scales with volatility. Like fib levels, these work through order clustering: stops, limit bids and breakout orders pile up around obvious swing points.',
    how: [
      'BUY AREA (green) = the nearest demand shelf under price. Longs are better bid there than chased mid-range.',
      'SELL AREA (red) = the nearest supply lid above price. Rallies into it tend to stall first touch; take profit or fade there.',
      'A CLEAN break-and-hold through a zone flips its meaning: old supply becomes support and vice versa.',
      'Strongest entries are confluence: a zone overlapping the golden pocket or a band exhaustion dot.',
    ],
  },
  macd: {
    name: 'MACD(12, 26, 9)',
    text:
      'Trend + momentum crossover: MACD line = 12 EMA minus 26 EMA, signal line = 9 EMA of the MACD, histogram = the gap between them. It answers "which way is momentum leaning and is it growing or fading".',
    how: [
      'Histogram flips sign = a cross: a fresh momentum shift in that direction.',
      'Bright bars = momentum expanding; faded bars = fading, a cross may be coming.',
      'Above the zero line = uptrend regime, below = downtrend. Prefer trades WITH the regime.',
      'Use it to CONFIRM what bands + RSI suggest; a MACD cross alone is late in chop.',
    ],
  },
}

// ── verdict engine ("should I trade?") ─────────────────────────

interface Factor {
  score: number
  text: string
}

export function computeFactors(ctx: JarvisContext): Factor[] {
  const factors: Factor[] = []

  if (ctx.sel.bands && ctx.bands) {
    const b = ctx.bands
    if (b.zone === 'above-upper')
      factors.push({
        score: -2,
        text: `price is stretched ABOVE the +2.5σ band (top-signal territory, ${b.pctFromMid.toFixed(1)}% above the 30 EMA), chasing longs here is the classic mistake`,
      })
    else if (b.zone === 'below-lower')
      factors.push({
        score: 2,
        text: `price is flushed BELOW the -2.5σ band (bottom-signal territory, ${b.pctFromMid.toFixed(1)}% from the 30 EMA), stretched shorts often snap back`,
      })
    else if (b.zone === 'upper-half')
      factors.push({ score: 1, text: `price is above the 30 EMA (trend up, ${b.pctFromMid.toFixed(1)}% over balance)` })
    else factors.push({ score: -1, text: `price is below the 30 EMA (trend down, ${b.pctFromMid.toFixed(1)}% under balance)` })
    if (b.lastSignal && b.lastSignal.barsAgo <= 10)
      factors.push({
        score: b.lastSignal.kind === 'top' ? -1 : 1,
        text: `a ${b.lastSignal.kind} exhaustion dot printed ${b.lastSignal.barsAgo} bar${b.lastSignal.barsAgo === 1 ? '' : 's'} ago`,
      })
  }

  if (ctx.sel.rsi && ctx.rsi) {
    const r = ctx.rsi
    if (r.zone === 'overbought') factors.push({ score: -1, text: `RSI is overbought at ${r.value.toFixed(1)}` })
    else if (r.zone === 'oversold') factors.push({ score: 1, text: `RSI is oversold at ${r.value.toFixed(1)}` })
    else factors.push({ score: r.zone === 'bullish' ? 0.5 : -0.5, text: `RSI is ${r.zone} at ${r.value.toFixed(1)}` })
    if (r.lastDivergence && r.lastDivergence.barsAgo <= 20)
      factors.push({
        score: r.lastDivergence.kind === 'BULL' ? 2 : -2,
        text: `a ${r.lastDivergence.kind} divergence confirmed ${r.lastDivergence.barsAgo} bars ago, the strongest signal on this panel`,
      })
  }

  if (ctx.sel.macd && ctx.macd) {
    const mc = ctx.macd
    factors.push({
      score: (mc.aboveSignal ? 0.5 : -0.5) + (mc.hist >= 0 ? (mc.rising ? 0.5 : 0) : mc.rising ? 0 : -0.5),
      text: `MACD is ${mc.aboveSignal ? 'above' : 'below'} its signal line, histogram ${mc.hist >= 0 ? 'positive' : 'negative'} and ${mc.rising ? 'building' : 'fading'}${mc.crossedBarsAgo != null ? `, crossed ${mc.crossedBarsAgo} bars ago` : ''}`,
    })
  }

  if (ctx.sel.fib && ctx.fib) {
    const f = ctx.fib
    if (f.inGoldenPocket)
      factors.push({
        score: f.direction === 'up' ? 1.5 : -1.5,
        text: `price is INSIDE the golden pocket (0.618-0.65 retracement of the ${f.direction}-move) - the crowded ${f.direction === 'up' ? 'pullback-bid' : 'bounce-fade'} zone`,
      })
    else if (f.nearest.distPct < 0.35)
      factors.push({
        score: 0,
        text: `price is pressing the ${f.nearest.ratio} fib at ${fmtPx(f.nearest.px)} (${f.nearest.distPct.toFixed(2)}% away) - expect orders clustered here`,
      })
    else
      factors.push({
        score: 0,
        text: `nearest fib level is ${f.nearest.ratio} at ${fmtPx(f.nearest.px)} (${f.nearest.distPct.toFixed(1)}% away)`,
      })
  }

  if (ctx.sel.zones && ctx.zones) {
    const z = ctx.zones
    if (z.buy?.inside)
      factors.push({ score: 1.5, text: `price is INSIDE the buy area (${fmtPx(z.buy.bottom)}–${fmtPx(z.buy.top)}), the nearest demand shelf` })
    else if (z.sell?.inside)
      factors.push({ score: -1.5, text: `price is INSIDE the sell area (${fmtPx(z.sell.bottom)}–${fmtPx(z.sell.top)}), the nearest supply lid` })
    else {
      if (z.buy && z.buy.distPct < 0.5)
        factors.push({ score: 0.5, text: `buy area is only ${z.buy.distPct.toFixed(2)}% below (${fmtPx(z.buy.bottom)}–${fmtPx(z.buy.top)})` })
      if (z.sell && z.sell.distPct < 0.5)
        factors.push({ score: -0.5, text: `sell area is only ${z.sell.distPct.toFixed(2)}% above (${fmtPx(z.sell.bottom)}–${fmtPx(z.sell.top)})` })
    }
  }

  return factors
}

export interface TradePlan {
  side: 'long' | 'short'
  entry: number
  stop: number
  tp: number
  riskPct: number
  rewardPct: number
  rr: number
}

/** Build stop/target from the nearest real structure: zones, bands, fib swing. */
export function tradePlan(ctx: JarvisContext, side: 'long' | 'short'): TradePlan | null {
  const p = ctx.price
  const below: number[] = []
  const above: number[] = []
  if (ctx.zones?.buy) below.push(ctx.zones.buy.bottom)
  if (ctx.zones?.sell) above.push(ctx.zones.sell.bottom)
  if (ctx.bands) {
    below.push(ctx.bands.lower)
    above.push(ctx.bands.upper)
  }
  if (ctx.fib) {
    below.push(ctx.fib.swingLow)
    above.push(ctx.fib.swingHigh)
  }
  const belowP = below.filter((v) => v < p)
  const aboveP = above.filter((v) => v > p)
  if (!belowP.length || !aboveP.length) return null
  if (side === 'long') {
    const stop = Math.max(...belowP) * 0.9985 // just under the nearest structure
    const tp = Math.min(...aboveP)
    const riskPct = ((p - stop) / p) * 100
    const rewardPct = ((tp - p) / p) * 100
    if (riskPct <= 0.05 || rewardPct <= 0.05) return null
    return { side, entry: p, stop, tp, riskPct, rewardPct, rr: rewardPct / riskPct }
  }
  const stop = Math.min(...aboveP) * 1.0015 // just over the nearest structure
  const tp = Math.max(...belowP)
  const riskPct = ((stop - p) / p) * 100
  const rewardPct = ((p - tp) / p) * 100
  if (riskPct <= 0.05 || rewardPct <= 0.05) return null
  return { side, entry: p, stop, tp, riskPct, rewardPct, rr: rewardPct / riskPct }
}

const fmtRR = (rr: number) => `1 : ${rr.toFixed(1)}`

/** Short, human answer by default; pass detail=true (user asked "why") for the full read. */
export function verdict(ctx: JarvisContext, detail = false): string {
  const factors = computeFactors(ctx)
  if (!factors.length)
    return "No indicators are on right now; flip one on and I can read the chart for you."

  const total = factors.reduce((s, f) => s + f.score, 0)
  const scoreTxt = `${total > 0 ? '+' : ''}${total.toFixed(1)}`
  const side: 'long' | 'short' | null = total >= 2.5 ? 'long' : total <= -2.5 ? 'short' : null

  const lines: string[] = []
  if (!side) {
    const feel =
      Math.abs(total) < 1
        ? 'genuinely mixed'
        : total > 0
          ? 'a bit bullish, but not enough to act on'
          : 'a bit bearish, but not enough to act on'
    lines.push(
      `Honestly? I'd skip this one. ${ctx.sym} on the ${ctx.interval} is ${feel} right now (score ${scoreTxt}; I want ±2.5 before calling it a trade). Sitting out costs nothing.`,
    )
  } else {
    const plan = tradePlan(ctx, side)
    if (!plan) {
      lines.push(
        `The signals lean ${side.toUpperCase()} (score ${scoreTxt}), but there's no clean structure nearby for a stop and target, so I can't give you a plan I'd trust. I'd pass.`,
      )
    } else if (plan.rr < 1.3) {
      lines.push(
        `The signals lean ${side.toUpperCase()} (score ${scoreTxt}), but the math kills it: the target is only ${plan.rewardPct.toFixed(1)}% away while the logical stop risks ${plan.riskPct.toFixed(1)}%. That's ${fmtRR(plan.rr)} risk:reward, not worth taking. Wait for a better entry.`,
      )
    } else {
      lines.push(`This one's doable: ${side.toUpperCase()} ${ctx.sym} on the ${ctx.interval} (score ${scoreTxt}).`)
      lines.push(
        [
          `Entry: around ${fmtPx(plan.entry)}`,
          `Stop loss: ${fmtPx(plan.stop)} (risking ${plan.riskPct.toFixed(1)}%)`,
          `Take profit: ${fmtPx(plan.tp)} (${plan.rewardPct.toFixed(1)}% in your favor)`,
          `Risk:reward ≈ ${fmtRR(plan.rr)}`,
        ].join('\n'),
      )
      lines.push(`Size it so hitting the stop stings but never hurts. Confluence, not certainty.`)
    }
  }

  if (detail) {
    lines.push(`Here's the full read:`)
    lines.push(factors.map((f) => `• ${f.text} (${f.score > 0 ? '+' : ''}${f.score})`).join('\n'))
  } else {
    lines.push(`Ask "why?" and I'll walk you through every signal.`)
  }
  return lines.join('\n\n')
}

// ── question router ────────────────────────────────────────────

function liveReading(ctx: JarvisContext, key: keyof IndicatorSel): string {
  if (key === 'bands' && ctx.bands) {
    const b = ctx.bands
    return `Right now on ${ctx.sym} ${ctx.interval}: price ${fmtPx(ctx.price)} is in the ${b.zone.replace('-', ' ')} zone, ${b.pctFromMid.toFixed(1)}% from the 30 EMA (${fmtPx(b.mid)}). Bands: ${fmtPx(b.lower)} / ${fmtPx(b.upper)}.${b.lastSignal ? ` Last ${b.lastSignal.kind} dot: ${b.lastSignal.barsAgo} bars ago.` : ' No recent exhaustion dot.'}`
  }
  if (key === 'rsi' && ctx.rsi) {
    const r = ctx.rsi
    return `Right now: RSI(14) is ${r.value.toFixed(1)} (${r.zone}).${r.lastDivergence ? ` Last divergence: ${r.lastDivergence.kind}, ${r.lastDivergence.barsAgo} bars ago.` : ' No recent divergence.'}`
  }
  if (key === 'fib' && ctx.fib) {
    const f = ctx.fib
    return `Right now: retracing the ${f.direction}-move (${fmtPx(f.swingLow)} -> ${fmtPx(f.swingHigh)}). ${f.inGoldenPocket ? 'Price is INSIDE the golden pocket (0.618-0.65).' : `Nearest level: ${f.nearest.ratio} at ${fmtPx(f.nearest.px)}, ${f.nearest.distPct.toFixed(2)}% away.`}`
  }
  if (key === 'zones' && ctx.zones) {
    const z = ctx.zones
    const b = z.buy ? `buy area ${fmtPx(z.buy.bottom)}–${fmtPx(z.buy.top)}${z.buy.inside ? ' (price INSIDE)' : ` (${z.buy.distPct.toFixed(2)}% below)`}` : 'no demand pivot below'
    const sll = z.sell ? `sell area ${fmtPx(z.sell.bottom)}–${fmtPx(z.sell.top)}${z.sell.inside ? ' (price INSIDE)' : ` (${z.sell.distPct.toFixed(2)}% above)`}` : 'no supply pivot above'
    return `Right now: ${b}; ${sll}.`
  }
  if (key === 'macd' && ctx.macd) {
    const mc = ctx.macd
    return `Right now: MACD ${mc.aboveSignal ? 'above' : 'below'} signal, histogram ${mc.hist.toFixed(4)} and ${mc.rising ? 'building' : 'fading'}${mc.crossedBarsAgo != null ? `, last cross ${mc.crossedBarsAgo} bars ago` : ''}.`
  }
  return ''
}

export function heuristicAnswer(question: string, ctx: JarvisContext): string {
  const q = question.toLowerCase()
  if (/\bwhy\b|breakdown|full read|in detail|reasoning|walk me/.test(q)) return verdict(ctx, true)
  if (/(should|worth|good time|do i|entry|enter).*(trade|long|short|buy|sell)|trade or not|should i (long|short|buy|sell)/.test(q) || q.trim() === 'should i trade?')
    return verdict(ctx)
  if (/band|ema|envelope|deviation|sigma|σ/.test(q))
    return `${EXPLAINERS.bands.text}\n\n${liveReading(ctx, 'bands')}`
  if (/zone|area|supply|demand|support|resistance|buy area|sell area/.test(q))
    return `${EXPLAINERS.zones.text}\n\n${liveReading(ctx, 'zones')}`
  if (/fib|retrace|golden|pocket|0\.618|618/.test(q))
    return `${EXPLAINERS.fib.text}\n\n${liveReading(ctx, 'fib')}`
  if (/rsi|diverg|pivot|overbought|oversold/.test(q))
    return `${EXPLAINERS.rsi.text}\n\n${liveReading(ctx, 'rsi')}`
  if (/macd|histogram|cross/.test(q)) return `${EXPLAINERS.macd.text}\n\n${liveReading(ctx, 'macd')}`
  if (/long|short|buy|sell|trade|setup|read|chart|analy/.test(q)) return verdict(ctx)
  return [
    `I'm Jarvis. I read the indicators on this chart. Ask me:`,
    `• "explain the bands / RSI / MACD"`,
    `• "should I trade?" for a live confluence read`,
    `• toggle a filter above the chart and I'll break down what it does`,
  ].join('\n')
}

// ── AI path: the messages sent to the LLM ──────────────────────

const AI_SYSTEM = `You are Jarvis, the AI trading assistant inside Self-Hosted Perp DEX with AI Agents, a self-hosted Hyperliquid perpetuals terminal built on OpenFinance.

Who you are:
- A sharp, experienced trader and a good teacher. Talk like a smart friend on a trading desk: direct, specific, and willing to take a view when the evidence supports it.
- You can talk about anything: trading strategy and psychology, risk and position sizing, technical and fundamental analysis, macro, crypto, stocks, commodities, FX, perps and funding, options, DeFi and on-chain topics, market history, how exchanges work, and questions that have nothing to do with markets. Answer the question that was asked; do not drag every answer back to this chart.

What you can see:
- Each question arrives with the live state of the chart the user has open (market, timeframe, price, and the readings of the indicators that are switched on) plus the terminal's built-in engine read. That is your only live market data.
- Use it whenever the question is about this market or "the setup", and quote the real numbers. If an indicator is switched off its reading is null: say so instead of guessing.
- For other markets, current prices, news or events you have no live feed: answer from what you know and say it may be out of date. Never invent a current price, statistic or headline.
- You cannot see the user's account, balance, positions or orders. When the user asks about "my balance" they mean their account money, not a chart line: say you cannot see it, and that the trade ticket on the right shows their balance and position once their key is added.

The terminal's tools (explain them when asked):
- EMA Bands: ${EXPLAINERS.bands.text}
- RSI + divergences: ${EXPLAINERS.rsi.text}
- MACD: ${EXPLAINERS.macd.text}
- Fib levels: ${EXPLAINERS.fib.text}
- Buy/Sell areas: ${EXPLAINERS.zones.text}
- Trade ticket: market orders on Hyperliquid through OpenFinance with the user's own key; long or short, size in USDC or coins with a % of balance slider, leverage and cross or isolated margin, reduce only, optional TP/SL. The user confirms every order. It shows balance, available to trade, current position, estimated liquidation, order value and margin. Deposit shows the account's Hyperliquid address for USDC. It cannot withdraw.
- Key levels to watch (collapsible): golden pocket, fib levels, RSI, buy/sell areas and bands.

How to answer:
- Match the length to the question: a line or two for small talk and quick facts; a fuller answer with steps or "- " lists for strategy, explanations and trade plans.
- Plain text only: short paragraphs and "- " lists. No markdown headings, bold, tables or code blocks; the chat shows raw text.
- When asked whether to trade: give a clear lean (long, short or wait), where you would enter, the level that proves it wrong and a target, with the reasons from the readings. You may agree or disagree with the built-in engine; say why.
- Be honest about risk and uncertainty without lecturing: at most one short risk note, never promise profit, no long disclaimers.
- You cannot place orders yourself. If the user wants to act, help them plan the trade, then point them to the trade ticket; they confirm every order there.`

/** System prompt + recent turns + the question, with the open chart's live state attached for reference. */
export function aiMessages(question: string, ctx: JarvisContext, history: ChatMsg[]): ChatMsg[] {
  const live = [
    `Today is ${new Date().toUTCString()}.`,
    `Chart the user has open, live (${ctx.sym} ${ctx.interval}, price ${fmtPx(ctx.price)}):`,
    JSON.stringify(ctx),
    '',
    `Built-in engine read:`,
    verdict(ctx, true),
  ].join('\n')
  return [
    { role: 'system', content: AI_SYSTEM },
    ...history.slice(-8),
    { role: 'user', content: `${live}\n\nQuestion: ${question}` },
  ]
}
