import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts'
import type { Candle } from '../lib/hyperliquid'
import { computeRSI, findRsiTags, emaBands, macdCalc, fibRetracement } from '../lib/indicators'
import { tradeZones, ZonesPrimitive, type Zone } from '../lib/zones'

const UP = '#26bd87'
const DOWN = '#f0616d'
const ACCENT = '#4c7ef3'

export interface IndicatorSel {
  bands: boolean
  rsi: boolean
  macd: boolean
  fib: boolean
  zones: boolean
}

interface ChartApi {
  chart: IChartApi
  candle: ISeriesApi<'Candlestick'>
  candleMarkers: ISeriesMarkersPluginApi<Time> | null
  bandMid?: ISeriesApi<'Line'>
  bandUp?: ISeriesApi<'Line'>
  bandLo?: ISeriesApi<'Line'>
  bandInUp?: ISeriesApi<'Line'>
  bandInLo?: ISeriesApi<'Line'>
  rsi?: ISeriesApi<'Line'>
  rsiMarkers?: ISeriesMarkersPluginApi<Time>
  macdHist?: ISeriesApi<'Histogram'>
  macdLine?: ISeriesApi<'Line'>
  macdSig?: ISeriesApi<'Line'>
  fibLines: IPriceLine[]
  fibKey: string
  zonesPrim: ZonesPrimitive | null
}

function ts(t: number): UTCTimestamp {
  return (t / 1000) as UTCTimestamp
}

// Lightweight-charts defaults the price axis/labels to 2 decimals, so sub-cent
// tokens (kPEPE, BONK, PEPE at ~$0.0027) render as "0.00". Derive precision
// from the price magnitude — ~4-5 significant figures — so small prices show
// their real value on the axis, last-price label, and crosshair.
function priceFmt(px: number): { precision: number; minMove: number } {
  const p = Math.abs(px)
  let precision: number
  if (!isFinite(p) || p === 0) precision = 2
  else if (p >= 1000) precision = 2
  else if (p >= 1) precision = 4
  else {
    const lead = Math.floor(-Math.log10(p)) // zeros right after the decimal point
    precision = Math.min(10, lead + 4) // 4 significant figures past the leading zeros
  }
  return { precision, minMove: 1 / 10 ** precision }
}

function lineData(candles: Candle[], values: (number | null)[]) {
  const out: { time: UTCTimestamp; value: number }[] = []
  for (let i = 0; i < candles.length; i++) {
    const v = values[i]
    if (v != null) out.push({ time: ts(candles[i].t), value: v })
  }
  return out
}

export function Chart({
  candles,
  indicators,
  dataKey,
  shotRef,
}: {
  candles: Candle[] | null
  indicators: IndicatorSel
  /** identity of the candle stream (coin + interval) — two different coins can
   * produce arrays with identical firstT/length, so time alone can't detect a switch */
  dataKey: string
  shotRef?: React.MutableRefObject<(() => HTMLCanvasElement) | null>
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ChartApi | null>(null)
  const candlesRef = useRef<Candle[] | null>(null)
  const prevRef = useRef<{ key: string; firstT: number; len: number } | null>(null)
  const lastIndRef = useRef(0)
  const indicatorsRef = useRef(indicators)
  candlesRef.current = candles
  indicatorsRef.current = indicators

  const indKey = `${indicators.bands}|${indicators.rsi}|${indicators.macd}|${indicators.fib}|${indicators.zones}`

  // (re)build the chart whenever the indicator set changes
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const chart = createChart(el, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#8b909a',
        fontSize: 13,
        panes: { separatorColor: '#23262c', separatorHoverColor: '#343943' },
      },
      grid: {
        vertLines: { color: '#14161a' },
        horzLines: { color: '#14161a' },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#23262c' },
      rightPriceScale: { borderColor: '#23262c' },
      crosshair: { mode: 0 },
      autoSize: true,
    })

    const api: ChartApi = {
      chart,
      candle: chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderVisible: false,
        wickUpColor: UP,
        wickDownColor: DOWN,
      }),
      candleMarkers: null,
      fibLines: [],
      fibKey: '',
      zonesPrim: null,
    }

    if (indicators.zones || indicators.fib) {
      api.zonesPrim = new ZonesPrimitive()
      api.candle.attachPrimitive(api.zonesPrim as never)
    }

    const bandLineOpts = {
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }
    if (indicators.bands) {
      api.bandUp = chart.addSeries(LineSeries, { ...bandLineOpts, color: '#4c7ef380' })
      api.bandLo = chart.addSeries(LineSeries, { ...bandLineOpts, color: '#4c7ef380' })
      api.bandInUp = chart.addSeries(LineSeries, { ...bandLineOpts, color: '#4c7ef335' })
      api.bandInLo = chart.addSeries(LineSeries, { ...bandLineOpts, color: '#4c7ef335' })
      api.bandMid = chart.addSeries(LineSeries, {
        ...bandLineOpts,
        color: ACCENT,
        lineWidth: 2,
      })
      api.candleMarkers = createSeriesMarkers(api.candle, [])
    }

    let paneIdx = 1
    if (indicators.rsi) {
      api.rsi = chart.addSeries(
        LineSeries,
        {
          color: '#c6cad2',
          lineWidth: 2,
          priceLineVisible: false,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        },
        paneIdx,
      )
      api.rsi.createPriceLine({
        price: 70,
        color: '#f0616d55',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      })
      api.rsi.createPriceLine({
        price: 30,
        color: '#26bd8755',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      })
      api.rsiMarkers = createSeriesMarkers(api.rsi, [])
      chart.panes()[paneIdx]?.setHeight(200)
      paneIdx++
    }

    if (indicators.macd) {
      api.macdHist = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIdx,
      )
      api.macdLine = chart.addSeries(
        LineSeries,
        { color: UP, lineWidth: 2, priceLineVisible: false },
        paneIdx,
      )
      api.macdSig = chart.addSeries(
        LineSeries,
        { color: '#8ab0f8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        paneIdx,
      )
      chart.panes()[paneIdx]?.setHeight(170)
      paneIdx++
    }

    apiRef.current = api
    prevRef.current = null
    if (shotRef) shotRef.current = () => chart.takeScreenshot()
    feed(true)

    return () => {
      chart.remove()
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey])

  // feed data on candle updates
  useEffect(() => {
    const api = apiRef.current
    const ks = candlesRef.current
    if (!api || !ks?.length) return
    const firstT = ks[0].t
    const prev = prevRef.current
    const incremental =
      prev != null &&
      prev.key === dataKey &&
      prev.firstT === firstT &&
      ks.length >= prev.len &&
      ks.length - prev.len <= 1
    if (incremental) {
      const last = ks[ks.length - 1]
      api.candle.update({ time: ts(last.t), open: last.o, high: last.h, low: last.l, close: last.c })
      // indicator tails refresh at most 1×/s — cheap full recompute
      if (Date.now() - lastIndRef.current > 1000) feed(false)
    } else {
      feed(true)
    }
    prevRef.current = { key: dataKey, firstT, len: ks.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, dataKey])

  function feed(full: boolean) {
    const api = apiRef.current
    const ks = candlesRef.current
    if (!api || !ks?.length) return
    lastIndRef.current = Date.now()
    const closes = ks.map((k) => k.c)

    if (full) {
      // set axis/label precision from this asset's price so sub-cent tokens
      // (kPEPE, BONK, …) don't collapse to "0.00"
      api.candle.applyOptions({ priceFormat: { type: 'price', ...priceFmt(closes[closes.length - 1]) } })
      api.candle.setData(
        ks.map((k) => ({ time: ts(k.t), open: k.o, high: k.h, low: k.l, close: k.c })),
      )
    }

    if (api.bandMid && api.bandUp && api.bandLo && api.bandInUp && api.bandInLo) {
      const b = emaBands(ks)
      api.bandMid.setData(lineData(ks, b.mid))
      api.bandUp.setData(lineData(ks, b.upper))
      api.bandLo.setData(lineData(ks, b.lower))
      api.bandInUp.setData(lineData(ks, b.innerUpper))
      api.bandInLo.setData(lineData(ks, b.innerLower))
      const markers: SeriesMarker<UTCTimestamp>[] = b.signals.map((s) => ({
        time: ts(ks[s.index].t),
        position: s.kind === 'top' ? 'aboveBar' : 'belowBar',
        color: s.kind === 'top' ? '#f0616d' : '#26bd87',
        shape: 'circle',
        size: 1.1,
      }))
      api.candleMarkers?.setMarkers(markers)
    }

    const sel = indicatorsRef.current
    if (api.zonesPrim) {
      const zs: Zone[] = sel.zones ? tradeZones(ks) : []
      if (sel.fib) {
        const fib = fibRetracement(ks)
        if (fib) {
          const gp1 = fib.levels.find((l) => l.ratio === 0.618)!.px
          const gp2 = fib.levels.find((l) => l.ratio === 0.65)!.px
          zs.push({
            bottom: Math.min(gp1, gp2),
            top: Math.max(gp1, gp2),
            kind: 'pocket',
            label: fib.direction === 'up' ? 'GOLDEN POCKET · BID' : 'GOLDEN POCKET · FADE',
          })
        }
      }
      api.zonesPrim.setZones(zs)
    }

    if (sel.fib) {
      const fib = fibRetracement(ks)
      const key = fib ? `${fib.direction}|${fib.swingHigh}|${fib.swingLow}` : 'none'
      if (key !== api.fibKey) {
        api.fibKey = key
        for (const l of api.fibLines) api.candle.removePriceLine(l)
        api.fibLines = []
        if (fib) {
          for (const lv of fib.levels) {
            const golden = lv.ratio === 0.618 || lv.ratio === 0.65
            const endpoint = lv.ratio === 0 || lv.ratio === 1
            api.fibLines.push(
              api.candle.createPriceLine({
                price: lv.px,
                color: golden ? '#e3b341' : endpoint ? '#3a3f48' : '#5f6b83aa',
                lineWidth: 1,
                lineStyle: endpoint ? LineStyle.Solid : golden ? LineStyle.Solid : LineStyle.Dashed,
                axisLabelVisible: false,
                title: endpoint ? (lv.ratio === 0 ? 'swing' : 'anchor') : String(lv.ratio),
              }),
            )
          }
        }
      }
    }

    if (api.rsi) {
      const rsi = computeRSI(closes)
      api.rsi.setData(lineData(ks, rsi))
      const tags = findRsiTags(closes, rsi)
      // plain pivots are dots only — PIVOT text overlapped badly at scale
      const markers: SeriesMarker<UTCTimestamp>[] = tags.map((tag) => {
        const time = ts(ks[tag.index].t)
        if (tag.label === 'BULL')
          return { time, position: 'belowBar', color: '#26bd87', shape: 'arrowUp', text: 'BULL', size: 1.4 }
        if (tag.label === 'BEAR')
          return { time, position: 'aboveBar', color: '#f0616d', shape: 'arrowDown', text: 'BEAR', size: 1.4 }
        return {
          time,
          position: tag.kind === 'low' ? 'belowBar' : 'aboveBar',
          color: '#5f6b83',
          shape: 'circle',
          size: 0.7,
        }
      })
      api.rsiMarkers?.setMarkers(markers)
    }

    if (api.macdHist && api.macdLine && api.macdSig) {
      const m = macdCalc(closes)
      const hist: { time: UTCTimestamp; value: number; color: string }[] = []
      for (let i = 0; i < ks.length; i++) {
        const v = m.hist[i]
        if (v == null) continue
        const prevV = m.hist[i - 1]
        const rising = prevV == null || v >= prevV
        hist.push({
          time: ts(ks[i].t),
          value: v,
          color: v >= 0 ? (rising ? '#26bd87' : '#26bd8770') : rising ? '#f0616d70' : '#f0616d',
        })
      }
      api.macdHist.setData(hist)
      api.macdLine.setData(lineData(ks, m.macd))
      api.macdSig.setData(lineData(ks, m.signal))
    }

    if (full) api.chart.timeScale().fitContent()
  }

  return (
    <div className="chart-wrap">
      {!candles && <div className="chart-loading">Loading candles…</div>}
      <div ref={elRef} className="chart-el" />
    </div>
  )
}
