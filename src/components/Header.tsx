import { useEffect, useState } from 'react'
import { fmtPx, fmtUsd, type AssetCtx } from '../lib/hyperliquid'
import { CATEGORY_LABEL, type PerpAsset } from '../lib/universe'
import { PairSelector } from './PairSelector'
import { useOfKey } from '../lib/ofkey'
import { openKeyModal } from '../lib/keyModal'

function useFundingCountdown(): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = 3_600_000 - (now % 3_600_000)
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export type View = 'terminal' | 'how'

const KeyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3 20 3M16 7l3 3M14 9l2 2" />
  </svg>
)

export function TopBar({
  wsLive,
  view,
  onView,
  upnl,
}: {
  wsLive: boolean
  view: View
  onView: (v: View) => void
  /** unrealized P&L across open positions; null until the account has loaded */
  upnl: number | null
}) {
  const key = useOfKey()
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-orb">◈</span>
        <span className="brand-name">Self-Hosted Perp DEX</span>
        <span className="beta-chip">BETA</span>
      </div>
      <nav className="view-tabs" role="tablist" aria-label="Page">
        <button role="tab" aria-selected={view === 'terminal'} className={view === 'terminal' ? 'on' : ''} onClick={() => onView('terminal')}>
          Terminal
        </button>
        <button role="tab" aria-selected={view === 'how'} className={view === 'how' ? 'on' : ''} onClick={() => onView('how')}>
          How it works
        </button>
      </nav>
      <div className="topbar-right">
        <button className={`key-btn ${key ? 'on' : ''}`} onClick={openKeyModal}>
          <KeyIcon />
          {key ? 'Key connected' : 'Add OpenFinance key'}
          {key && <span className="key-btn-dot" />}
        </button>
        {key && upnl != null && (
          <span
            className={`upnl-box ${upnl > 0.005 ? 'up' : upnl < -0.005 ? 'down' : ''}`}
            title="Unrealized profit or loss on your open positions"
          >
            <span className="upnl-k">UPNL</span>
            {upnl > 0.005 ? '+' : upnl < -0.005 ? '-' : ''}$
            {Math.abs(upnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <span className="builton muted">
          Built on <b>openfinance.tech</b>
        </span>
        <span className={`ws-dot ${wsLive ? 'live' : ''}`} />
        <span className="muted live-label">{wsLive ? 'live' : 'connecting'}</span>
      </div>
    </div>
  )
}

/** GTR-style pair row: selector + big live price + dotted-label stat columns */
export function PairRow({
  asset,
  universe,
  onSelect,
  ctx,
  children,
}: {
  asset: PerpAsset
  universe: PerpAsset[] | null
  onSelect: (a: PerpAsset) => void
  ctx: AssetCtx | null
  children?: React.ReactNode
}) {
  const countdown = useFundingCountdown()
  const changePct = ctx && ctx.prevDayPx ? ((ctx.markPx - ctx.prevDayPx) / ctx.prevDayPx) * 100 : 0
  const pos = changePct >= 0
  return (
    <div className="pairrow">
      <PairSelector universe={universe} current={asset} onSelect={onSelect} />
      <div className="pr-price">
        <span className="pr-mark">{ctx ? `$${fmtPx(ctx.markPx)}` : '–'}</span>
        <span className={`pr-pct ${pos ? 'up' : 'down'}`}>
          {ctx ? `${pos ? '+' : ''}${changePct.toFixed(2)}%` : ''}
        </span>
      </div>
      <Col label="Oracle Price" value={ctx ? `$${fmtPx(ctx.oraclePx)}` : '–'} />
      <Col label="24h Volume" value={ctx ? fmtUsd(ctx.dayNtlVlm) : '–'} />
      <Col label="Open Interest" value={ctx ? fmtUsd(ctx.openInterest * ctx.markPx) : '–'} />
      <Col
        label="Funding / Countdown"
        value={ctx ? `${(ctx.funding * 100).toFixed(5)}% / ${countdown}` : '–'}
        tone={ctx ? (ctx.funding >= 0 ? 'up' : 'down') : undefined}
      />
      {children}
      <div className="pr-meta muted">
        {CATEGORY_LABEL[asset.category] ?? asset.category}
        {asset.dex ? ` · ${asset.dex}` : ''} · max {asset.maxLeverage}x · szDec {asset.szDecimals}
      </div>
    </div>
  )
}

function Col({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="pr-col">
      <div className="pr-label">{label}</div>
      <div className={`pr-value ${tone ?? ''}`}>{value}</div>
    </div>
  )
}
