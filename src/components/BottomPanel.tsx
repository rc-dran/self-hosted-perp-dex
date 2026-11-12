import { useEffect, useState } from 'react'
import { fmtPx, fmtUsd } from '../lib/hyperliquid'
import type { PerpAsset } from '../lib/universe'
import {
  getOpenOrders,
  getFills,
  cancelOrder,
  type AccountState,
  type OpenOrder,
  type Fill,
} from '../lib/openfin'

type Tab = 'positions' | 'balances' | 'orders' | 'history'

export function BottomPanel({
  hasKey,
  account,
  asset,
  universe,
  refreshTick,
  onClose,
}: {
  hasKey: boolean
  account: AccountState | null
  asset: PerpAsset
  universe: PerpAsset[] | null
  refreshTick: number
  onClose: (coin: string) => Promise<string>
}) {
  const [tab, setTab] = useState<Tab>('positions')
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [fills, setFills] = useState<Fill[]>([])
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null) // Close asks once more before it sends
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!hasKey) {
      setOrders([])
      setFills([])
      return
    }
    let live = true
    const load = () => {
      getOpenOrders(asset.dex || undefined)
        .then((o) => live && setOrders(o))
        .catch(() => {})
      getFills()
        .then((f) => live && setFills(f))
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 10000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [asset.dex, refreshTick, hasKey])

  async function cancel(o: OpenOrder) {
    const a = universe?.find((u) => u.sym === o.coin)?.assetIndex
    if (cancelling) return
    if (a == null) {
      setNote('Markets are still loading. Try the cancel again in a moment.')
      return
    }
    setCancelling(o.oid)
    try {
      await cancelOrder(a, o.oid)
      setOrders((prev) => prev.filter((x) => x.oid !== o.oid))
      setNote(`Cancelled your ${o.isBuy ? 'buy' : 'sell'} order on ${o.coin}.`)
    } catch (e: any) {
      setNote(e?.message ?? "The cancel didn't go through. Check Open Orders.")
    } finally {
      setCancelling(null)
    }
  }

  // same tables with or without a key; without one they stay empty and say why
  const hint = hasKey ? '' : ' · add your OpenFinance key to load your account'
  const positions = account?.positions ?? []
  const balances = (account?.balances ?? []).filter((b) => b.total > 0)

  return (
    <section className="bottom">
      <div className="bt-tabs">
        <button className={tab === 'positions' ? 'on' : ''} onClick={() => setTab('positions')}>
          Positions <span className="ct">{positions.length}</span>
        </button>
        <button className={tab === 'balances' ? 'on' : ''} onClick={() => setTab('balances')}>
          Balances <span className="ct">{balances.length}</span>
        </button>
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
          Open Orders <span className="ct">{orders.length}</span>
        </button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          History
        </button>
      </div>
      {note && (
        <div className="bt-note" role="status">
          <span>{note}</span>
          <button onClick={() => setNote(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <div className="bt-body">
        {tab === 'positions' &&
          (positions.length ? (
            <table>
              <thead>
                <tr>
                  <th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Value</th><th>uPnL</th><th>Liq.</th><th>Lev</th><th />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.coin}>
                    <td className="strong">{p.coin}</td>
                    <td className={p.szi > 0 ? 'up' : 'down'}>{p.szi > 0 ? 'LONG' : 'SHORT'}</td>
                    <td>{Math.abs(p.szi)}</td>
                    <td>{fmtPx(p.entryPx)}</td>
                    <td>{fmtUsd(Math.abs(p.positionValue))}</td>
                    <td className={p.unrealizedPnl >= 0 ? 'up' : 'down'}>
                      {p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl.toFixed(2)}
                    </td>
                    <td>{p.liquidationPx != null ? fmtPx(p.liquidationPx) : '–'}</td>
                    <td>{p.leverage != null ? `${p.leverage}x` : '–'}</td>
                    <td>
                      <button
                        className={`chip ${armed === p.coin ? 'armed' : ''}`}
                        disabled={closing === p.coin}
                        onBlur={() => setArmed((c) => (c === p.coin ? null : c))}
                        onClick={async () => {
                          if (armed !== p.coin) {
                            setArmed(p.coin)
                            return
                          }
                          setArmed(null)
                          setClosing(p.coin)
                          setNote(await onClose(p.coin))
                          setClosing(null)
                        }}
                        title={armed === p.coin ? 'Click again to close the whole position at market' : 'Close at market'}
                      >
                        {closing === p.coin ? 'Closing…' : armed === p.coin ? 'Confirm close' : 'Close'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bt-empty muted">No open positions{hint}</div>
          ))}

        {tab === 'balances' &&
          (balances.length ? (
            <table>
              <thead>
                <tr><th>Asset</th><th>Total</th><th>In orders</th><th>Available</th></tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.coin}>
                    <td className="strong">{b.coin}</td>
                    <td>{b.total.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                    <td>{b.hold.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                    <td>{(b.total - b.hold).toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bt-empty muted">No balances{hint}</div>
          ))}

        {tab === 'orders' &&
          (orders.length ? (
            <table>
              <thead>
                <tr><th>Market</th><th>Side</th><th>Type</th><th>Price</th><th>Remaining</th><th>Original</th><th>Time</th><th /></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.oid}>
                    <td className="strong">{o.coin}</td>
                    <td className={o.isBuy ? 'up' : 'down'}>{o.isBuy ? 'BUY' : 'SELL'}</td>
                    <td>{o.orderType}</td>
                    <td>{fmtPx(o.limitPx)}</td>
                    <td>{o.sz}</td>
                    <td>{o.origSz}</td>
                    <td className="muted">{new Date(o.timestamp).toLocaleTimeString()}</td>
                    <td>
                      <button className="chip" disabled={cancelling === o.oid} onClick={() => cancel(o)}>
                        {cancelling === o.oid ? '…' : 'Cancel'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bt-empty muted">No open orders{hint}</div>
          ))}

        {tab === 'history' &&
          (fills.length ? (
            <table>
              <thead>
                <tr><th>Time</th><th>Market</th><th>Dir</th><th>Price</th><th>Size</th><th>Closed PnL</th><th>Fee</th></tr>
              </thead>
              <tbody>
                {fills.map((f, i) => (
                  <tr key={i}>
                    <td className="muted">{new Date(f.time).toLocaleString()}</td>
                    <td className="strong">{f.coin}</td>
                    <td className={f.isBuy ? 'up' : 'down'}>{f.dir || (f.isBuy ? 'Buy' : 'Sell')}</td>
                    <td>{fmtPx(f.px)}</td>
                    <td>{f.sz}</td>
                    <td className={f.closedPnl >= 0 ? 'up' : 'down'}>
                      {f.closedPnl !== 0 ? `${f.closedPnl >= 0 ? '+' : ''}${f.closedPnl.toFixed(2)}` : '–'}
                    </td>
                    <td className="muted">{f.fee.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="bt-empty muted">No fills yet{hint}</div>
          ))}
      </div>
    </section>
  )
}
