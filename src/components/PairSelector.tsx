import { useMemo, useState } from 'react'
import { fmtPx, fmtUsd } from '../lib/hyperliquid'
import { CATEGORY_LABEL, type PerpAsset } from '../lib/universe'

const BADGE_COLORS = ['#f7931a', '#627eea', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b']

/** Real coin logo from the spothq icon set, falling back to a letter badge
 * for HIP-3 stocks and anything the set doesn't know. */
export function CoinLogo({ base, size = 22 }: { base: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (err)
    return (
      <span
        className="coin-badge"
        style={{ width: size, height: size, fontSize: size * 0.5, background: badgeColor(base) }}
      >
        {base.slice(0, 1)}
      </span>
    )
  return (
    <img
      className="coin-logo"
      style={{ width: size, height: size }}
      src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${base.toLowerCase()}.svg`}
      onError={() => setErr(true)}
      alt={base}
    />
  )
}

function badgeColor(sym: string): string {
  if (sym === 'BTC') return '#f7931a'
  if (sym === 'ETH') return '#627eea'
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0
  return BADGE_COLORS[h % BADGE_COLORS.length]
}

export function PairSelector({
  universe,
  current,
  onSelect,
}: {
  universe: PerpAsset[] | null
  current: PerpAsset
  onSelect: (a: PerpAsset) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')

  const cats = useMemo(() => {
    if (!universe) return []
    const counts = new Map<string, number>()
    for (const a of universe) counts.set(a.category, (counts.get(a.category) ?? 0) + 1)
    return [...counts.entries()].sort((x, y) => y[1] - x[1])
  }, [universe])

  const rows = useMemo(() => {
    if (!universe) return []
    const ql = q.trim().toLowerCase()
    return universe
      .filter((a) => {
        if (cat !== 'all' && a.category !== cat) return false
        if (
          ql &&
          !a.base.toLowerCase().includes(ql) &&
          !a.sym.toLowerCase().includes(ql) &&
          !a.dex.toLowerCase().includes(ql)
        )
          return false
        return true
      })
      .sort((x, y) => y.vol24 - x.vol24)
      .slice(0, 250)
  }, [universe, q, cat])

  return (
    <div className="pair-sel">
      <button className="pair-btn" onClick={() => setOpen(!open)}>
        <CoinLogo base={current.base} size={22} />
        <span className="pair-name">{current.sym}-USDC</span>
        <span className="lev-chip">{current.maxLeverage}x</span>
        <span className={`chev ${open ? 'up' : ''}`}>▾</span>
      </button>
      {open && (
        <>
          <div className="pair-overlay" onClick={() => setOpen(false)} />
          <div className="pair-panel">
            <input
              autoFocus
              className="tp-input pair-search"
              placeholder="Search all markets…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="chips-row">
              <button
                className={`chip ${cat === 'all' ? 'on' : ''}`}
                onClick={() => setCat('all')}
              >
                All <span className="ct">{universe?.length ?? 0}</span>
              </button>
              {cats.map(([c, n]) => (
                <button
                  key={c}
                  className={`chip ${cat === c ? 'on' : ''}`}
                  onClick={() => setCat(c)}
                >
                  {CATEGORY_LABEL[c] ?? c} <span className="ct">{n}</span>
                </button>
              ))}
            </div>
            <div className="pair-list">
              <div className="pair-row pair-row-head">
                <span>Market</span>
                <span>Price</span>
                <span>24h</span>
                <span>Volume</span>
              </div>
              {!universe && <div className="muted pair-loading">Loading universe…</div>}
              {rows.map((a) => (
                <button
                  key={a.sym}
                  className={`pair-row ${a.sym === current.sym ? 'sel' : ''}`}
                  onClick={() => {
                    onSelect(a)
                    setOpen(false)
                  }}
                >
                  <span className="pr-name">
                    <CoinLogo base={a.base} size={18} />
                    {a.base}
                    {a.dex && <span className="dex-tag">{a.dex}</span>}
                  </span>
                  <span className="pr-px">{fmtPx(a.px)}</span>
                  <span className={a.ch24 >= 0 ? 'up' : 'down'}>
                    {a.ch24 >= 0 ? '+' : ''}
                    {a.ch24.toFixed(2)}%
                  </span>
                  <span className="muted">{fmtUsd(a.vol24)}</span>
                </button>
              ))}
              {universe && !rows.length && <div className="muted pair-loading">No matches</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
