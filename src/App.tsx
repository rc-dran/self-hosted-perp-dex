import { useCallback, useEffect, useRef, useState } from 'react'
import { HLSocket, fetchCandles, parseCtx, roundPx, roundSz, INTERVALS, INTERVAL_LABEL, type AssetCtx, type Candle, type Interval, fetchTopOfBook, fmtPx } from './lib/hyperliquid'
import { loadUniverse, type PerpAsset } from './lib/universe'
import { getAccount, ensureUnified, placeOrders, type AccountState } from './lib/openfin'
import { getOfKey, useOfKey } from './lib/ofkey'
import { EXPLAINERS } from './lib/jarvis'
import { TopBar, PairRow, type View } from './components/Header'
import { HowItWorks } from './components/HowItWorks'
import { KeyModal } from './components/KeyModal'
import { Chart, type IndicatorSel } from './components/Chart'
import { RiskPanel } from './components/RiskPanel'
import { Jarvis } from './components/Jarvis'
import { BottomPanel } from './components/BottomPanel'
import { SharePreviewModal } from './components/SharePreviewModal'

// known-good BTC defaults so the chart renders before the universe loads
const DEFAULT_BTC: PerpAsset = {
  sym: 'BTC',
  base: 'BTC',
  dex: '',
  assetIndex: 0,
  szDecimals: 5,
  maxLeverage: 40,
  px: 0,
  ch24: 0,
  vol24: 0,
  category: 'crypto',
}

function useHL(coin: string, interval: Interval) {
  // candle feed is tagged with its coin|interval key so a stale array can
  // never be attributed to the newly selected market during a switch
  const [feed, setFeed] = useState<{ key: string; candles: Candle[] } | null>(null)
  const [ctx, setCtx] = useState<AssetCtx | null>(null)
  const [wsLive, setWsLive] = useState(false)
  const socketRef = useRef<HLSocket | null>(null)
  const keyRef = useRef('')

  useEffect(() => {
    setCtx(null)
    const socket = new HLSocket()
    socketRef.current = socket
    socket.connect()
    socket.subscribe({ type: 'activeAssetCtx', coin })

    // Throttle candle merges to ~5/s — busy books tick much faster than that.
    let pending: { key: string; candle: Candle } | null = null
    let lastFlush = 0
    const flush = () => {
      if (!pending) return
      const { key, candle: next } = pending
      pending = null
      lastFlush = Date.now()
      setFeed((prev) => {
        if (!prev || prev.key !== key || !prev.candles.length) return prev
        const lastT = prev.candles[prev.candles.length - 1].t
        if (next.t === lastT) return { key, candles: [...prev.candles.slice(0, -1), next] }
        if (next.t > lastT) return { key, candles: [...prev.candles.slice(-999), next] }
        return prev
      })
    }
    const flushTimer = setInterval(flush, 200)

    const off = socket.onMessage((channel, data) => {
      if (channel === 'activeAssetCtx' && data?.coin === coin) {
        setWsLive(true)
        setCtx(parseCtx(data.ctx))
      } else if (channel === 'candle' && data?.s === coin) {
        const key = `${coin}|${data.i}`
        if (key !== keyRef.current) return
        pending = {
          key,
          candle: { t: data.t, o: +data.o, h: +data.h, l: +data.l, c: +data.c, v: +data.v },
        }
        if (Date.now() - lastFlush > 200) flush()
      }
    })

    return () => {
      off()
      clearInterval(flushTimer)
      socket.dispose()
      socketRef.current = null
      setWsLive(false)
    }
  }, [coin])

  useEffect(() => {
    const key = `${coin}|${interval}`
    keyRef.current = key
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setFeed(null)
    // keep trying (1s, 2s, 4s… up to every 15s) so a dropped connection at
    // load time does not leave the chart stuck on "Loading candles…"
    const load = (attempt: number) => {
      fetchCandles(coin, interval)
        .then((ks) => {
          if (!cancelled && keyRef.current === key) setFeed({ key, candles: ks })
        })
        .catch((e) => {
          if (cancelled) return
          console.warn(`candleSnapshot failed (attempt ${attempt + 1}), retrying`, e)
          retryTimer = setTimeout(() => load(attempt + 1), Math.min(15_000, 1000 * 2 ** attempt))
        })
    }
    load(0)
    const sub = { type: 'candle', coin, interval }
    socketRef.current?.subscribe(sub)
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      socketRef.current?.unsubscribe(sub)
    }
  }, [coin, interval])

  const key = `${coin}|${interval}`
  return { candles: feed?.key === key ? feed.candles : null, ctx, wsLive }
}

const FILTERS: { key: keyof IndicatorSel; label: string }[] = [
  { key: 'bands', label: 'EMA Bands' },
  { key: 'rsi', label: 'RSI + Div' },
  { key: 'macd', label: 'MACD' },
  { key: 'fib', label: 'Fib Levels' },
  { key: 'zones', label: 'Buy/Sell Areas' },
]

function IndicatorInfoModal({
  k,
  onClose,
}: {
  k: keyof IndicatorSel
  onClose: () => void
}) {
  const e = EXPLAINERS[k]
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-head">
          <h3>{e.name}</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <p className="modal-body">{e.text}</p>
        <div className="modal-sub">How it's supposed to work</div>
        <ul className="modal-list">
          {e.how.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
        <div className="modal-foot muted">Ask Jarvis for a live reading of this indicator any time.</div>
      </div>
    </div>
  )
}

// GTR toolbar: visible TFs + ▾ for the rest, ƒx Indicators on the left;
// active indicator toggles live on the RIGHT of the toolbar (SuperTrend spot)
const VISIBLE_TFS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d']

function TfMore({
  interval,
  onSelect,
}: {
  interval: Interval
  onSelect: (tf: Interval) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ind-menu">
      <button className={`tf-btn ${open ? 'active' : ''}`} onClick={() => setOpen(!open)}>▾</button>
      {open && (
        <>
          <div className="pair-overlay" onClick={() => setOpen(false)} />
          <div className="ind-panel tf-panel">
            {INTERVALS.map((tf) => (
              <button
                key={tf}
                className={`ind-item as-btn ${tf === interval ? 'sel' : ''}`}
                onClick={() => {
                  onSelect(tf)
                  setOpen(false)
                }}
              >
                {INTERVAL_LABEL[tf]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function IndicatorsMenu({
  sel,
  onChange,
  onInfo,
}: {
  sel: IndicatorSel
  onChange: (s: IndicatorSel) => void
  onInfo: (k: keyof IndicatorSel) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ind-menu">
      <button className={`fx-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        <i>ƒ</i>x&ensp;Indicators
      </button>
      {open && (
        <>
          <div className="pair-overlay" onClick={() => setOpen(false)} />
          <div className="ind-panel">
            <div className="muted ind-head">Indicators</div>
            {FILTERS.map((f) => (
              <label key={f.key} className="ind-item">
                <input
                  type="checkbox"
                  checked={sel[f.key]}
                  onChange={(e) => onChange({ ...sel, [f.key]: e.target.checked })}
                />
                <span>{f.label}</span>
                <span
                  className="i-btn"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onInfo(f.key)
                  }}
                >
                  i
                </span>
              </label>
            ))}
            <div className="muted ind-foot">more indicators coming; Jarvis will explain each</div>
          </div>
        </>
      )}
    </div>
  )
}

function FilterToggles({
  sel,
  onChange,
  onInfo,
}: {
  sel: IndicatorSel
  onChange: (s: IndicatorSel) => void
  onInfo: (k: keyof IndicatorSel) => void
}) {
  return (
    <div className="ind-toggles" role="group" aria-label="Chart indicators">
      {FILTERS.map((f) => (
        <div key={f.key} className={`ind-toggle ${sel[f.key] ? 'on' : ''}`}>
          <button
            className="ind-toggle-main"
            aria-pressed={sel[f.key]}
            onClick={() => onChange({ ...sel, [f.key]: !sel[f.key] })}
          >
            <span className="ind-toggle-dot" />
            {f.label}
          </button>
          <button className="i-btn" title={`What is ${f.label}?`} aria-label={`What is ${f.label}?`} onClick={() => onInfo(f.key)}>
            i
          </button>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('terminal')
  const [universe, setUniverse] = useState<PerpAsset[] | null>(null)
  const [asset, setAsset] = useState<PerpAsset>(DEFAULT_BTC)
  const [interval, setIntervalTf] = useState<Interval>('1h')
  const [indicators, setIndicators] = useState<IndicatorSel>({
    bands: true,
    rsi: true,
    macd: false,
    fib: true,
    zones: true,
  })
  const [refreshTick, setRefreshTick] = useState(0)
  const [infoFor, setInfoFor] = useState<keyof IndicatorSel | null>(null)
  const shotRef = useRef<(() => HTMLCanvasElement) | null>(null)
  const [shareCanvas, setShareCanvas] = useState<HTMLCanvasElement | null>(null)

  function shareChart() {
    const canvas = shotRef.current?.()
    if (canvas) setShareCanvas(canvas)
  }

  const { candles, ctx, wsLive } = useHL(asset.sym, interval)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const load = (attempt: number) =>
      loadUniverse()
        .then((u) => {
          if (cancelled) return
          setUniverse(u)
          const btc = u.find((a) => a.sym === 'BTC')
          if (btc) setAsset((cur) => (cur.sym === 'BTC' ? btc : cur))
        })
        .catch((e) => {
          if (cancelled) return
          console.warn(`universe load failed (attempt ${attempt + 1}), retrying`, e)
          retryTimer = setTimeout(() => load(attempt + 1), Math.min(15_000, 1000 * 2 ** attempt))
        })
    load(0)
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [])

  const ofKey = useOfKey() // the visitor's OpenFinance key (this tab only); unlocks account + trading
  const [account, setAccount] = useState<AccountState | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const unifiedCheckedRef = useRef(false)
  const assetDexRef = useRef(asset.dex)
  assetDexRef.current = asset.dex

  const accountSeqRef = useRef(0)
  const dexesRef = useRef<string[]>([])
  dexesRef.current = universe ? [...new Set(universe.map((u) => u.dex).filter(Boolean))] : []

  const refreshAccount = useCallback(() => {
    // only the newest read may land: a slow read for the previous market must
    // never overwrite the current one (it could show "no position" by mistake)
    const seq = ++accountSeqRef.current
    getAccount(assetDexRef.current || undefined, dexesRef.current)
      .then(async (state) => {
        if (!getOfKey() || seq !== accountSeqRef.current) return // key removed or a newer read started
        setAccount(state)
        setAccountError(null)
        if (!unifiedCheckedRef.current) {
          unifiedCheckedRef.current = true
          try {
            if (await ensureUnified(state)) {
              setNotice("I've set your account to unifiedAccount")
              setAccount(await getAccount(assetDexRef.current || undefined, dexesRef.current))
            }
          } catch (e: any) {
            console.error('auto-unify failed', e)
          }
        }
      })
      .catch((e: any) =>
        seq === accountSeqRef.current &&
        setAccountError(
          e?.status === 401 || e?.status === 403
            ? e.message
            : /429/.test(String(e?.message))
              ? 'Hyperliquid is busy. Retrying…'
              : "Can't load your account right now. Retrying…",
        ),
      )
  }, [])

  useEffect(() => {
    // No key in this tab: no account, nothing to read.
    if (!ofKey) {
      setAccount(null)
      setAccountError(null)
      setNotice(null)
      unifiedCheckedRef.current = false
      return
    }
    refreshAccount()
    // account state comes straight from HL public info API, cheap to poll
    const id = setInterval(refreshAccount, 5000)
    return () => clearInterval(id)
  }, [refreshAccount, asset.dex, ofKey])

  // close a position from the bottom Positions tab (any coin, not just selected)
  // close a position at market from the Positions tab; priced off the live
  // order book (not the price saved at page load), and says what happened
  const closeFromTable = useCallback(
    async (coin: string): Promise<string> => {
      if (!ofKey) return 'Add your OpenFinance key first.'
      const pos = account?.positions.find((p) => p.coin === coin)
      const u = universe?.find((x) => x.sym === coin)
      if (!pos || !u) return "Couldn't find that position. It may already be closed."
      const isBuy = pos.szi < 0
      try {
        const { bid, ask } = await fetchTopOfBook(coin)
        const res = await placeOrders([
          {
            a: u.assetIndex,
            b: isBuy,
            p: roundPx(isBuy ? ask * 1.01 : bid * 0.99, u.szDecimals),
            s: roundSz(Math.abs(pos.szi), u.szDecimals),
            r: true,
            t: { limit: { tif: u.dex ? 'FrontendMarket' : 'Ioc' } },
          },
        ])
        if (res.status === 'filled') return `Closed ${res.totalSz} ${coin} at ${fmtPx(parseFloat(res.avgPx ?? '0'))}.`
        if (res.status === 'resting') return `Close order is waiting to fill (order ${res.oid}). Check Open Orders.`
        return res.error ?? "The close didn't go through. Try again."
      } catch (e: any) {
        return e?.message === 'empty order book'
          ? "Couldn't read the order book, so nothing was sent. Try again."
          : `${e?.message ?? "The close didn't go through."} Check Positions before trying again.`
      } finally {
        refreshAccount()
        setRefreshTick((t) => t + 1)
      }
    },
    [account, universe, refreshAccount, ofKey],
  )

  return (
    <div className="app">
      <TopBar wsLive={wsLive} view={view} onView={setView} upnl={ofKey && account ? account.unrealizedPnl : null} />
      <KeyModal />
      {view === 'how' && <HowItWorks onOpenTerminal={() => setView('terminal')} />}
      {/* The terminal stays mounted under How it works, so the chart, feed and
          Jarvis' conversation are all still there when you come back. */}
      <div className={`terminal-view ${view === 'terminal' ? '' : 'is-hidden'}`}>
      <PairRow asset={asset} universe={universe} onSelect={setAsset} ctx={ctx}>
        <FilterToggles sel={indicators} onChange={setIndicators} onInfo={setInfoFor} />
      </PairRow>
      <div className="toolbar">
        <div className="tf-row">
          {VISIBLE_TFS.map((tf) => (
            <button
              key={tf}
              className={`tf-btn ${tf === interval ? 'active' : ''}`}
              onClick={() => setIntervalTf(tf)}
            >
              {INTERVAL_LABEL[tf]}
            </button>
          ))}
          {!VISIBLE_TFS.includes(interval) && (
            <button className="tf-btn active">{INTERVAL_LABEL[interval]}</button>
          )}
          <TfMore interval={interval} onSelect={setIntervalTf} />
          <span className="tb-sep" />
          <IndicatorsMenu sel={indicators} onChange={setIndicators} onInfo={setInfoFor} />
        </div>
        <button className="fx-btn share-btn" onClick={shareChart} title="Save a picture of the chart">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          Share
        </button>
      </div>
      {infoFor && <IndicatorInfoModal k={infoFor} onClose={() => setInfoFor(null)} />}
      {shareCanvas && (
        <SharePreviewModal
          canvas={shareCanvas}
          filename={`${asset.base}-${interval}-tradeindicator.png`}
          onClose={() => setShareCanvas(null)}
        />
      )}
      <main className="main">
        <Chart candles={candles} indicators={indicators} dataKey={`${asset.sym}|${interval}`} shotRef={shotRef} />
        <Jarvis asset={asset} interval={interval} candles={candles} sel={indicators} />
        <RiskPanel
          key={asset.sym}
          asset={asset}
          ctx={ctx}
          candles={candles}
          interval={interval}
          account={account}
          accountError={accountError}
          notice={notice}
          refreshAccount={refreshAccount}
          onOrderPlaced={() => setRefreshTick((t) => t + 1)}
        />
      </main>
      <BottomPanel
        hasKey={!!ofKey}
        account={account}
        asset={asset}
        universe={universe}
        refreshTick={refreshTick}
        onClose={closeFromTable}
      />
      </div>
    </div>
  )
}
