// Buy/Sell areas: auto-detected supply/demand zones from the nearest untested
// swing pivots, sized by ATR. Rendered as shaded rectangles via a lightweight
// series primitive attached to the candle series.

import type { Candle } from './hyperliquid'

export interface Zone {
  top: number
  bottom: number
  kind: 'buy' | 'sell' | 'pocket'
  label: string
}

export function tradeZones(candles: Candle[], lookback = 250): Zone[] {
  const ks = candles.slice(-lookback)
  const n = ks.length
  if (n < 40) return []
  const price = ks[n - 1].c

  // simple ATR(14) for zone thickness
  let trSum = 0
  for (let i = n - 14; i < n; i++) {
    trSum += Math.max(
      ks[i].h - ks[i].l,
      Math.abs(ks[i].h - ks[i - 1].c),
      Math.abs(ks[i].l - ks[i - 1].c),
    )
  }
  const atr = trSum / 14
  if (!atr) return []

  // swing pivots (fractal, L bars each side)
  const L = 10
  const pivotHighs: number[] = []
  const pivotLows: number[] = []
  for (let i = L; i < n - L; i++) {
    let isH = true
    let isL = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      if (ks[j].h >= ks[i].h) isH = false
      if (ks[j].l <= ks[i].l) isL = false
      if (!isH && !isL) break
    }
    if (isH) pivotHighs.push(i)
    if (isL) pivotLows.push(i)
  }

  const zones: Zone[] = []
  // nearest supply above price → sell area
  const above = pivotHighs.map((i) => ks[i].h).filter((h) => h > price).sort((a, b) => a - b)
  if (above.length)
    zones.push({
      bottom: above[0] - 0.25 * atr,
      top: above[0] + 0.5 * atr,
      kind: 'sell',
      label: 'SELL AREA',
    })
  // nearest demand below price → buy area
  const below = pivotLows.map((i) => ks[i].l).filter((l) => l < price).sort((a, b) => b - a)
  if (below.length)
    zones.push({
      bottom: below[0] - 0.5 * atr,
      top: below[0] + 0.25 * atr,
      kind: 'buy',
      label: 'BUY AREA',
    })
  return zones
}

// ── rendering primitive ─────────────────────────────────────────

const FILL: Record<Zone['kind'], string> = {
  buy: 'rgba(38, 189, 135, 0.13)',
  sell: 'rgba(240, 97, 109, 0.12)',
  pocket: 'rgba(227, 179, 65, 0.10)',
}
const EDGE: Record<Zone['kind'], string> = {
  buy: 'rgba(38, 189, 135, 0.45)',
  sell: 'rgba(240, 97, 109, 0.45)',
  pocket: 'rgba(227, 179, 65, 0.40)',
}
const TEXT: Record<Zone['kind'], string> = {
  buy: '#26bd87',
  sell: '#f0616d',
  pocket: '#e3b341',
}

/** Draws horizontal shaded zones across the full pane width. */
export class ZonesPrimitive {
  private zones: Zone[] = []
  private series: any = null
  private requestUpdate: (() => void) | null = null

  attached(param: any) {
    this.series = param.series
    this.requestUpdate = param.requestUpdate
  }

  detached() {
    this.series = null
    this.requestUpdate = null
  }

  setZones(zones: Zone[]) {
    this.zones = zones
    this.requestUpdate?.()
  }

  updateAllViews() {}

  paneViews() {
    return [
      {
        renderer: () => ({
          draw: (target: any) => {
            target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: any) => {
              if (!this.series) return
              for (const z of this.zones) {
                const y1 = this.series.priceToCoordinate(z.top)
                const y2 = this.series.priceToCoordinate(z.bottom)
                if (y1 == null || y2 == null) continue
                const top = Math.min(y1, y2)
                const h = Math.abs(y2 - y1)
                if (top > mediaSize.height || top + h < 0 || h < 2) continue
                ctx.fillStyle = FILL[z.kind]
                ctx.fillRect(0, top, mediaSize.width, h)
                ctx.strokeStyle = EDGE[z.kind]
                ctx.lineWidth = 1
                ctx.strokeRect(0.5, top + 0.5, mediaSize.width - 1, Math.max(h - 1, 1))
                ctx.fillStyle = TEXT[z.kind]
                ctx.font = '600 11px Inter, sans-serif'
                ctx.fillText(z.label, 8, top + 15)
              }
            })
          },
        }),
      },
    ]
  }
}
