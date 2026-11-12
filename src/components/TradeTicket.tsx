import { useEffect, useState } from 'react'
import { fetchTopOfBook, fmtPx, roundPx, roundSz, type AssetCtx } from '../lib/hyperliquid'
import type { PerpAsset } from '../lib/universe'
import {
  getWalletAddress,
  placeOrders,
  setLeverage,
  type AccountState,
  type DexMargin,
  type OrderResult,
  type RawOrder,
} from '../lib/openfin'
import { useOfKey } from '../lib/ofkey'
import { openKeyModal } from '../lib/keyModal'

/* Market-order ticket: real orders on Hyperliquid through OpenFinance with the
   visitor's own key, each one confirmed first. */

const SLIPPAGE = 0.01 // market orders are IOC limits up to 1% through the mid
const MIN_NOTIONAL = 10 // Hyperliquid's minimum order value
const TAKER_FEE = 0.00045 // 0.045% per fill, kept as headroom when sizing
const TICKS = [0, 25, 50, 75, 100]

export type Side = 'long' | 'short'

const fmtSize = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })
const usd2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function TradeTicket({
  asset,
  ctx,
  account,
  accountError,
  notice,
  side,
  setSide,
  leverage,
  setLeverage: setLev,
  isCross,
  setCross,
  refreshAccount,
  onOrderPlaced,
}: {
  asset: PerpAsset
  ctx: AssetCtx | null
  account: AccountState | null
  accountError: string | null
  notice: string | null
  side: Side
  setSide: (s: Side) => void
  leverage: number
  setLeverage: (n: number) => void
  isCross: boolean
  setCross: (c: boolean) => void
  refreshAccount: () => void
  onOrderPlaced: () => void
}) {
  const key = useOfKey()
  const [size, setSize] = useState('')
  const [unit, setUnit] = useState<'usd' | 'coin'>('usd')
  const [reduceOnly, setReduceOnly] = useState(false)
  const [tpsl, setTpsl] = useState(false)
  const [tpPx, setTpPx] = useState('')
  const [slPx, setSlPx] = useState('')
  const [levOpen, setLevOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<OrderResult | null>(null)

  const d = asset.szDecimals
  // the live mid from the socket; without it the ticket waits rather than
  // trusting the price saved when the page loaded
  const mid = ctx?.midPx || ctx?.markPx || 0

  // any edit cancels a pending confirmation, so what you confirm is what you see
  useEffect(() => setConfirming(false), [size, unit, side, leverage, isCross, reduceOnly, tpsl, tpPx, slPx])

  const isBuy = side === 'long'
  const dir = isBuy ? 1 : -1
  const raw = parseFloat(size) || 0
  const sz = roundSz(unit === 'usd' ? (mid ? raw / mid : 0) : raw, d)
  const szNum = parseFloat(sz) || 0
  const notional = szNum * mid
  const pool: DexMargin | null = account ? (account.byDex[asset.dex] ?? account.byDex[''] ?? null) : null
  const available = pool?.available ?? null
  // what the slider can spend: margin at the 1% worst price plus the taker fee must fit
  const maxNotional = available != null && available > 0 ? available / ((1 + SLIPPAGE) / leverage + TAKER_FEE) : 0
  const pct = maxNotional > 0 ? Math.min(100, ((unit === 'usd' ? raw : raw * mid) / maxNotional) * 100) : 0
  const position = account?.positions.find((p) => p.coin === asset.sym)
  const held = position?.szi ?? 0 // signed: + long, - short

  // The position after this order fills. An order against an open position
  // first closes it, and only the part beyond that needs new margin. An order
  // that only closes is sent as reduce-only (Hyperliquid needs that under $10).
  const closing = held !== 0 && Math.sign(held) !== dir
  const closes = closing ? Math.min(szNum, Math.abs(held)) : 0
  const opens = reduceOnly ? 0 : Math.max(0, szNum - closes)
  const reduce = reduceOnly || (closing && opens === 0)
  const after = held + dir * (reduce ? closes : szNum)
  const margin = (opens * mid) / leverage
  const marginNeeded = opens * mid * ((1 + SLIPPAGE) / leverage + TAKER_FEE)

  // Liquidation estimate. Maintenance margin on Hyperliquid is half the initial
  // margin at max leverage. Cross: the equity backing this dex is what can be
  // lost, less what other positions need; current open P&L is already in it,
  // so the move is measured from the market price. Isolated: only this
  // position's margin can be lost.
  const mm = 1 / (2 * asset.maxLeverage)
  const S = Math.abs(after)
  let liqRaw = 0
  if (S > 0 && mid > 0) {
    if (isCross && pool) {
      const otherMaint = Math.max(0, pool.maintenance - (position ? Math.abs(position.positionValue) * mm : 0))
      liqRaw =
        after > 0
          ? (S * mid - pool.equity + otherMaint) / (S * (1 - mm))
          : (S * mid + pool.equity - otherMaint) / (S * (1 + mm))
    } else {
      const entry = held !== 0 && Math.sign(after) === Math.sign(held) && !closing
        ? (Math.abs(held) * position!.entryPx + szNum * mid) / S
        : held !== 0 && Math.sign(after) === Math.sign(held)
          ? position!.entryPx
          : mid
      const m = (S * entry) / leverage
      liqRaw = after > 0 ? (entry - m / S) / (1 - mm) : (entry + m / S) / (1 + mm)
    }
  }
  const liq = liqRaw > 0 ? liqRaw : null

  // TP/SL are checked at the exact prices that will be sent
  const tpSent = parseFloat(tpPx) > 0 ? roundPx(parseFloat(tpPx), d) : ''
  const slSent = parseFloat(slPx) > 0 ? roundPx(parseFloat(slPx), d) : ''
  const tp = parseFloat(tpSent) || 0
  const sl = parseFloat(slSent) || 0
  const legSz = roundSz(opens, d) // TP/SL protect the part this order opens
  const tpslProblem = !tpsl
    ? null
    : opens === 0
      ? 'TP/SL only apply when the order opens or adds to a position'
      : !tp && !sl
        ? 'Set a TP or SL price'
        : tp && (isBuy ? tp <= mid : tp >= mid)
          ? `TP must be ${isBuy ? 'above' : 'below'} the price`
          : sl && (isBuy ? sl >= mid : sl <= mid)
            ? `SL must be ${isBuy ? 'below' : 'above'} the price`
            : null

  const problem = !account
    ? (accountError ?? 'Loading your account…')
    : accountError
      ? accountError
      : !mid
        ? 'Waiting for the live price…'
        : szNum <= 0
          ? 'Enter a size'
          : notional < MIN_NOTIONAL && !reduce
            ? `Minimum order is $${MIN_NOTIONAL}`
            : reduceOnly && !closing
              ? `Reduce Only needs an open ${isBuy ? 'short' : 'long'} to shrink`
              : available != null && marginNeeded > available
                ? 'Not enough balance for this size'
                : tpslProblem

  const sideLabel = isBuy ? 'Long' : 'Short'
  const capPx = mid * (isBuy ? 1 + SLIPPAGE : 1 - SLIPPAGE)

  function setPct(p: number) {
    const usd = (maxNotional * p) / 100
    if (unit === 'usd') setSize(usd ? (Math.floor(usd * 100) / 100).toFixed(2) : '')
    else setSize(usd && mid ? roundSz(usd / mid, d) : '')
  }

  function switchUnit() {
    if (unit === 'usd') {
      setUnit('coin')
      setSize(szNum ? sz : '')
    } else {
      setUnit('usd')
      // round up to the cent so converting back gives the same coin size
      setSize(notional ? (Math.ceil(notional * 100) / 100).toFixed(2) : '')
    }
  }

  async function submit() {
    if (problem || busy) return
    setBusy(true)
    setResult(null)
    let sent = false
    try {
      // price off the live order book at send time, never a stale number
      let book: { bid: number; ask: number }
      try {
        book = await fetchTopOfBook(asset.sym)
      } catch {
        setResult({ status: 'error', error: "Couldn't read the live order book, so no order was sent. Try again." })
        return
      }
      const live = isBuy ? book.ask : book.bid
      if (Math.abs(live / mid - 1) > SLIPPAGE) {
        setResult({
          status: 'error',
          error: `The price moved more than 1% since you confirmed (now ${fmtPx(live)}), so no order was sent. Check the numbers and confirm again.`,
        })
        return
      }
      if (opens > 0) {
        // only an order that opens or adds uses leverage; a close keeps the position's settings
        try {
          await setLeverage(asset.assetIndex, isCross, leverage)
        } catch (e: any) {
          setResult({ status: 'error', error: `No order was sent: couldn't set ${leverage}x ${isCross ? 'cross' : 'isolated'}. ${e?.message ?? ''}`.trim() })
          return
        }
      }
      const px = roundPx(live * (isBuy ? 1 + SLIPPAGE : 1 - SLIPPAGE), d)
      const orders: RawOrder[] = [
        { a: asset.assetIndex, b: isBuy, p: px, s: sz, r: reduce, t: { limit: { tif: asset.dex ? 'FrontendMarket' : 'Ioc' } } },
      ]
      if (tpsl && tp) {
        orders.push({ a: asset.assetIndex, b: !isBuy, p: tpSent, s: legSz, r: true, t: { trigger: { isMarket: true, triggerPx: tpSent, tpsl: 'tp' } } })
      }
      if (tpsl && sl) {
        orders.push({ a: asset.assetIndex, b: !isBuy, p: slSent, s: legSz, r: true, t: { trigger: { isMarket: true, triggerPx: slSent, tpsl: 'sl' } } })
      }
      sent = true
      setResult(await placeOrders(orders, orders.length > 1 ? 'normalTpsl' : 'na'))
    } catch (e: any) {
      // once sent, a failure may have happened after the order reached Hyperliquid
      const unknown = sent && (e?.status === 0 || e?.status >= 502 || /couldn't do that right now/.test(e?.message ?? ''))
      setResult({
        status: 'error',
        error: unknown
          ? `${e?.message ?? ''} The order may or may not have gone through: check Positions and Open Orders before trying again.`.trim()
          : (e?.message ?? 'The order failed. Try again.'),
      })
    } finally {
      setBusy(false)
      setConfirming(false)
      refreshAccount()
      onOrderPlaced()
    }
  }

  return (
    <div className="tk">
      <div className="tk-bal">
        <span className="tk-bal-ico">$</span>
        <span>Balance</span>
        <b className="tk-cyan" title={account ? `Account value ${usd2(account.equity)}; ${usd2(available ?? 0)} is free to trade here` : undefined}>
          {account ? usd2(available ?? 0) : key ? '…' : '–'}
        </b>
        <button className="tk-dep" onClick={() => (key ? setDepositOpen((o) => !o) : openKeyModal())}>
          Deposit
        </button>
      </div>
      {key && depositOpen && <DepositBox />}
      {notice && <div className="tp-notice">{notice}</div>}

      <div className="tk-card">
        <div className="tk-modes">
          <button className="tk-mode" onClick={() => setCross(!isCross)} title="Switch margin mode">
            {isCross ? 'Cross' : 'Isolated'}
          </button>
          <button className={`tk-mode ${levOpen ? 'on' : ''}`} onClick={() => setLevOpen((o) => !o)}>
            {leverage}x
          </button>
        </div>
        {levOpen && (
          <div className="tk-lev">
            <input
              type="range"
              className="lev-slider"
              min={1}
              max={asset.maxLeverage}
              step={1}
              value={leverage}
              onChange={(e) => setLev(Number(e.target.value))}
            />
            <span className="muted">max {asset.maxLeverage}x</span>
          </div>
        )}

        <div className="tk-type">Market</div>

        <div className="tk-side">
          <button className={`long ${isBuy ? 'on' : ''}`} onClick={() => setSide('long')}>
            LONG
          </button>
          <button className={`short ${!isBuy ? 'on' : ''}`} onClick={() => setSide('short')}>
            SHORT
          </button>
        </div>

        <div className="tk-row">
          <span>Available to trade</span>
          <b className="tk-cyan">{available != null ? `${available.toFixed(2)} USDC` : '–'}</b>
        </div>
        <div className="tk-row">
          <span>Current Position</span>
          <b className={held ? (held > 0 ? 'up' : 'down') : ''}>
            {held ? `${held > 0 ? 'Long' : 'Short'} ${fmtSize(Math.abs(held))}` : '0'} {asset.base}
          </b>
        </div>
        <div className="tk-row">
          <span>Market price</span>
          <b>{mid ? fmtPx(mid) : '–'}</b>
        </div>

        <label className="tk-field">
          <span className="tk-label">Size</span>
          <span className="tk-input">
            <input inputMode="decimal" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value)} />
            <button type="button" className="tk-unit" onClick={switchUnit} title="Switch between USDC and coin">
              {unit === 'usd' ? 'USDC' : asset.base} ⇅
            </button>
          </span>
        </label>
        <input
          type="range"
          className="tk-slider"
          min={0}
          max={100}
          step={1}
          value={Math.round(pct)}
          disabled={!maxNotional}
          onChange={(e) => setPct(Number(e.target.value))}
        />
        <div className="tk-ticks">
          {TICKS.map((t) => (
            <button key={t} type="button" disabled={!maxNotional} onClick={() => setPct(t)}>
              {t}%
            </button>
          ))}
        </div>

        <label className="tk-check">
          <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} /> Reduce Only
        </label>
        <label className="tk-check">
          <input type="checkbox" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} /> TP/SL
        </label>
        {tpsl && (
          <div className="tk-tpsl">
            <span className="tk-input">
              <input inputMode="decimal" placeholder="TP price" value={tpPx} onChange={(e) => setTpPx(e.target.value)} />
            </span>
            <span className="tk-input">
              <input inputMode="decimal" placeholder="SL price" value={slPx} onChange={(e) => setSlPx(e.target.value)} />
            </span>
          </div>
        )}

        <div className="tk-sep" />
        <div className="tk-row">
          <span>Liquidation Price</span>
          <b>{liq ? fmtPx(liq) : '–'}</b>
        </div>
        <div className="tk-row">
          <span>Order Value</span>
          <b>{notional ? usd2(notional) : '–'}</b>
        </div>
        <div className="tk-row">
          <span>Margin Required</span>
          <b>{szNum ? `$${margin.toFixed(2)}` : '–'}</b>
        </div>

        {!key ? (
          <button className={`tk-submit ${side}`} onClick={openKeyModal}>
            Add OpenFinance key to trade
          </button>
        ) : confirming ? (
          <div className="tk-confirm">
            <div className="tk-confirm-title">
              {sideLabel} {sz} {asset.base} at market
            </div>
            <ul>
              <li>
                Order value {usd2(notional)}, fills up to about {fmtPx(capPx)} (at most 1% past the live price when sent)
              </li>
              {closes > 0 && (
                <li>
                  Closes {fmtSize(closes)} of your {held > 0 ? 'long' : 'short'}
                  {opens > 0 ? `, then opens a ${side} of ${fmtSize(opens)}` : ''}
                </li>
              )}
              <li>
                {leverage}x {isCross ? 'cross' : 'isolated'}, new margin ${margin.toFixed(2)}
                {after === 0 ? ', position fully closed' : liq ? `, est. liquidation ${fmtPx(liq)}` : ''}
              </li>
              {tpsl && (
                <li>
                  {tp ? `TP ${fmtPx(tp)}` : 'no TP'} · {sl ? `SL ${fmtPx(sl)}` : 'no SL'}, covering the {fmtSize(parseFloat(legSz))}{' '}
                  {asset.base} this order opens
                </li>
              )}
              {reduce && <li>Reduce only: it can only shrink your position</li>}
            </ul>
            <p className="muted">This places a real order on Hyperliquid from your OpenFinance account.</p>
            <div className="tk-confirm-row">
              <button className="tk-cancel" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button className={`tk-submit ${side}`} onClick={submit} disabled={busy}>
                {busy ? 'Placing…' : `Confirm ${sideLabel}`}
              </button>
            </div>
          </div>
        ) : (
          <button className={`tk-submit ${side}`} disabled={!!problem} onClick={() => setConfirming(true)}>
            {problem ?? `${sideLabel} ${asset.base}`}
          </button>
        )}

        {result && (
          <div className={`tp-result ${result.status}`}>
            <div className="tp-result-line">
              {result.status === 'filled' &&
                `Filled ${result.totalSz} ${asset.base} @ ${fmtPx(parseFloat(result.avgPx ?? '0'))}${
                  tpsl && !result.rejectedLegs?.length ? ' · TP/SL set' : ''
                }`}
              {result.status === 'resting' && `Order resting · oid ${result.oid}`}
              {result.status === 'error' && result.error}
            </div>
            {!!result.rejectedLegs?.length && (
              <div className="tp-result-line tk-leg-warn" role="alert">
                {result.rejectedLegs.map((l) => `Your ${l.kind} was rejected: ${l.reason}`).join(' ')}{' '}
                {result.rejectedLegs.some((l) => l.kind === 'SL') ? 'You have no stop-loss on this position.' : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DepositBox() {
  const [addr, setAddr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getWalletAddress().then(setAddr, (e) => setErr(e?.message ?? "Couldn't load your deposit address. Try again in a moment."))
  }, [])

  return (
    <div className="tk-deposit">
      <div className="tk-label">Your Hyperliquid deposit address</div>
      {addr ? (
        <div className="tk-addr">
          <code>{addr}</code>
          <button
            onClick={() =>
              navigator.clipboard.writeText(addr).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : err ? (
        <p className="jv-key-err">{err}</p>
      ) : (
        <p className="muted">Loading…</p>
      )}
      <p className="muted tk-note">
        Send USDC on Hyperliquid to this address; Hyperliquid only accepts USDC. To fund from another chain or with a
        card, use openfinance.tech.
      </p>
    </div>
  )
}
