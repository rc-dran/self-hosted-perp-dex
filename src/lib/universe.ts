// Tradable perp universe across the native dex + every HIP-3 dex,
// built the Locha way: perpDexs + metaAndAssetCtxs per dex.
// Asset index formula: native = position; HIP-3 = 100000 + dexIdx*10000 + position.

import { hlInfo } from './hyperliquid'

export interface PerpAsset {
  sym: string // 'BTC' native, 'xyz:NVDA' HIP-3
  base: string // 'BTC', 'NVDA'
  dex: string // '' for native
  assetIndex: number
  szDecimals: number
  maxLeverage: number
  px: number
  ch24: number // %
  vol24: number
  category: string
}

export const CATEGORY_LABEL: Record<string, string> = {
  crypto: 'Crypto',
  stocks: 'Stocks',
  indices: 'Indices',
  commodities: 'Commodities',
  fx: 'FX',
  preipo: 'Pre-IPO',
  other: 'Other',
}

function ctxVals(ctx: any): { px: number; ch24: number; vol24: number } {
  const px = +(ctx?.markPx ?? 0)
  const prev = +(ctx?.prevDayPx ?? 0)
  return {
    px,
    ch24: prev ? ((px - prev) / prev) * 100 : 0,
    vol24: +(ctx?.dayNtlVlm ?? 0),
  }
}

// Category per market, from public data only: native dex = crypto; HIP-3 dexes
// map by their known theme.
const DEX_CATEGORY: Record<string, string> = {
  xyz: 'stocks',
  flx: 'stocks',
  vntl: 'preipo',
  km: 'commodities',
  para: 'fx',
  hyna: 'indices',
}

function guessCategory(dex: string): string {
  if (!dex) return 'crypto'
  return DEX_CATEGORY[dex] ?? 'other'
}

export async function loadUniverse(): Promise<PerpAsset[]> {
  const [native, perpDexs] = await Promise.all([
    hlInfo<any[]>({ type: 'metaAndAssetCtxs' }),
    hlInfo<any[]>({ type: 'perpDexs' }),
  ])

  const out: PerpAsset[] = []

  const [meta, ctxs] = native
  ;(meta?.universe ?? []).forEach((u: any, i: number) => {
    if (u.isDelisted) return
    out.push({
      sym: u.name,
      base: u.name,
      dex: '',
      assetIndex: i,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage ?? 20,
      ...ctxVals(ctxs?.[i]),
      category: guessCategory(''),
    })
  })

  const dexEntries = (perpDexs ?? [])
    .map((d: any, idx: number) => ({ idx, name: d?.name ?? null }))
    .filter((d: any): d is { idx: number; name: string } => !!d.name)

  const dexResults = await Promise.all(
    dexEntries.map((d) => hlInfo<any[]>({ type: 'metaAndAssetCtxs', dex: d.name }).catch(() => null)),
  )

  dexEntries.forEach((d, di) => {
    const res = dexResults[di]
    if (!res) return
    const [m, cx] = res
    ;(m?.universe ?? []).forEach((u: any, pos: number) => {
      if (u.isDelisted) return
      const sym = String(u.name).includes(':') ? u.name : `${d.name}:${u.name}`
      const base = sym.split(':')[1] ?? u.name
      out.push({
        sym,
        base,
        dex: d.name,
        assetIndex: 100000 + d.idx * 10000 + pos,
        szDecimals: u.szDecimals,
        maxLeverage: u.maxLeverage ?? 10,
        ...ctxVals(cx?.[pos]),
        category: guessCategory(d.name),
      })
    })
  })

  return out
}
