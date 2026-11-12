import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fmtPx, type AssetCtx, type Candle, type Interval } from '../lib/hyperliquid'
import type { PerpAsset } from '../lib/universe'
import { buildContext, type JarvisContext } from '../lib/jarvis'
import type { AccountState } from '../lib/openfin'
import { TradeTicket, type Side } from './TradeTicket'

const ALL_ON = { bands: true, rsi: true, macd: true, fib: true, zones: true }

/* Right column: the market-order ticket, then the key levels as a collapsible block. */
export function RiskPanel({
  asset,
  ctx,
  candles,
  interval,
  account,
  accountError,
  notice,
  refreshAccount,
  onOrderPlaced,
}: {
  asset: PerpAsset
  ctx: AssetCtx | null
  candles: Candle[] | null
  interval: Interval
  account: AccountState | null
  accountError: string | null
  notice: string | null
  refreshAccount: () => void
  onOrderPlaced: () => void
}) {
  const [side, setSide] = useState<Side>('long')
  const [leverage, setLev] = useState(() => Math.min(20, asset.maxLeverage))
  const [isCross, setCross] = useState(true)

  // with a position open in this market, start from its leverage and margin
  // mode, so adding to it does not quietly change them (once per market)
  const position = account?.positions.find((p) => p.coin === asset.sym)
  const syncedRef = useRef(false)
  useEffect(() => {
    if (syncedRef.current || !position) return
    syncedRef.current = true
    if (position.leverage) setLev(Math.min(position.leverage, asset.maxLeverage))
    setCross(position.isCross)
  }, [position, asset.maxLeverage])

  const jctx: JarvisContext | null = useMemo(
    () => (candles?.length ? buildContext(asset.sym, interval, candles, ALL_ON) : null),
    [candles, asset.sym, interval],
  )

  const zones = jctx?.zones
  const levelsSummary =
    zones?.buy || zones?.sell
      ? [
          zones.buy && `buy ${zones.buy.inside ? 'inside' : `${zones.buy.distPct.toFixed(1)}% below`}`,
          zones.sell && `sell ${zones.sell.inside ? 'inside' : `${zones.sell.distPct.toFixed(1)}% above`}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : jctx?.rsi
        ? `RSI ${jctx.rsi.value.toFixed(0)}`
        : ''

  return (
    <aside className="trade-panel risk-panel">
      <TradeTicket
        asset={asset}
        ctx={ctx}
        account={account}
        accountError={accountError}
        notice={notice}
        side={side}
        setSide={setSide}
        leverage={leverage}
        setLeverage={setLev}
        isCross={isCross}
        setCross={setCross}
        refreshAccount={refreshAccount}
        onOrderPlaced={onOrderPlaced}
      />

      {jctx && (
        <Collapse id="levels" title="Key levels to watch" summary={levelsSummary}>
          <KeyLevels jctx={jctx} />
        </Collapse>
      )}
    </aside>
  )
}

// ── collapsible block (closed by default; remembers its state per viewer) ──

function Collapse({ id, title, summary, children }: { id: string; title: string; summary?: string; children: ReactNode }) {
  const storeKey = `tia.open.${id}`
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storeKey) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(storeKey, o ? '0' : '1')
      } catch {
        /* storage blocked: still toggles for this visit */
      }
      return !o
    })
  return (
    <section className={`rp-block ${open ? 'open' : ''}`}>
      <button className="rp-block-head" onClick={toggle} aria-expanded={open}>
        <span className="rp-block-title">{title}</span>
        <span className="rp-block-sum">{open ? '' : summary}</span>
        <span className="rp-block-chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="rp-block-body">{children}</div>}
    </section>
  )
}

// ── key levels box ──────────────────────────────────────────────

function KeyLevels({ jctx }: { jctx: JarvisContext }) {
  const p = jctx.price
  const near = (px: number) => Math.abs(px - p) / p < 0.004
  return (
    <div className="kl-rows">

      {jctx.fib && (
        <>
          <div className="kl-sec">
            Golden pocket <i className="gold">0.618–0.65</i>
          </div>
          <div className="kl-row gold-row">
            <span>
              {jctx.fib.direction === 'up' ? 'BID zone (pullback of up-move)' : 'FADE zone (bounce of down-move)'}
            </span>
            <b className="gold">{jctx.fib.inGoldenPocket ? 'price inside now' : 'see chart band'}</b>
          </div>
          <div className="kl-sec">Fib levels ({jctx.fib.direction}-move)</div>
          <FibRows jctx={jctx} near={near} />
        </>
      )}

      {jctx.rsi && (
        <>
          <div className="kl-sec">RSI(14)</div>
          <div className="kl-row">
            <span>Now</span>
            <b className={jctx.rsi.value >= 70 ? 'down' : jctx.rsi.value <= 30 ? 'up' : ''}>
              {jctx.rsi.value.toFixed(1)} · {jctx.rsi.zone}
            </b>
          </div>
          <div className="kl-row">
            <span>Watch</span>
            <b className="muted">70 overbought · 30 oversold</b>
          </div>
          {jctx.rsi.lastDivergence && (
            <div className="kl-row">
              <span>Last divergence</span>
              <b className={jctx.rsi.lastDivergence.kind === 'BULL' ? 'up' : 'down'}>
                {jctx.rsi.lastDivergence.kind} · {jctx.rsi.lastDivergence.barsAgo} bars ago
              </b>
            </div>
          )}
        </>
      )}

      {jctx.zones && (
        <>
          <div className="kl-sec">Supply / demand</div>
          {jctx.zones.sell && (
            <div className="kl-row">
              <span className="down">Sell area</span>
              <b>
                {fmtPx(jctx.zones.sell.bottom)}–{fmtPx(jctx.zones.sell.top)}
                {jctx.zones.sell.inside ? ' · inside' : ` · ${jctx.zones.sell.distPct.toFixed(1)}% above`}
              </b>
            </div>
          )}
          {jctx.zones.buy && (
            <div className="kl-row">
              <span className="up">Buy area</span>
              <b>
                {fmtPx(jctx.zones.buy.bottom)}–{fmtPx(jctx.zones.buy.top)}
                {jctx.zones.buy.inside ? ' · inside' : ` · ${jctx.zones.buy.distPct.toFixed(1)}% below`}
              </b>
            </div>
          )}
        </>
      )}

      {jctx.bands && (
        <>
          <div className="kl-sec">EMA bands</div>
          <div className="kl-row">
            <span>Upper +2.5σ</span>
            <b>{fmtPx(jctx.bands.upper)}</b>
          </div>
          <div className="kl-row">
            <span>30 EMA balance</span>
            <b>{fmtPx(jctx.bands.mid)}</b>
          </div>
          <div className="kl-row">
            <span>Lower −2.5σ</span>
            <b>{fmtPx(jctx.bands.lower)}</b>
          </div>
        </>
      )}
    </div>
  )
}

function FibRows({ jctx, near }: { jctx: JarvisContext; near: (px: number) => boolean }) {
  // rebuild level list from swing (same math as the chart)
  const f = jctx.fib!
  const range = f.swingHigh - f.swingLow
  const levels = [0.382, 0.5, 0.618, 0.65, 0.786].map((r) => ({
    r,
    px: f.direction === 'up' ? f.swingHigh - r * range : f.swingLow + r * range,
  }))
  return (
    <>
      {levels.map((l) => {
        const gold = l.r === 0.618 || l.r === 0.65
        return (
          <div key={l.r} className={`kl-row ${gold ? 'gold-row' : ''}`}>
            <span className={gold ? 'gold' : ''}>{l.r}</span>
            <b className={gold ? 'gold' : ''}>
              {fmtPx(l.px)} {near(l.px) && <i className="near">◄ price here</i>}
            </b>
          </div>
        )
      })}
    </>
  )
}
