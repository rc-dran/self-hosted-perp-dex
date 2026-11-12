import type { ReactNode } from 'react'
import { EXPLAINERS } from '../lib/jarvis'
import { AI_MODELS, costLabel } from '../lib/llm'
import type { IndicatorSel } from './Chart'

/* "How it works": the guide, laid out as rows (a quiet table) in three parts:
   your DEX, Jarvis, then the chart tools and safety. The indicator rows reuse
   Jarvis' own explainers, so the page and Jarvis never disagree. */

const INDICATOR_ORDER: (keyof IndicatorSel)[] = ['bands', 'rsi', 'macd', 'fib', 'zones']

interface Row {
  name: string
  what: ReactNode
  how: ReactNode
}

const KEY_ROWS: Row[] = [
  {
    name: 'Trading',
    what: 'Places real orders on Hyperliquid from your OpenFinance account: market orders, leverage, TP/SL, cancels.',
    how: 'Paste it once in the trade ticket or in Jarvis; both use the same key.',
  },
  {
    name: 'AI',
    what: 'Runs Jarvis on top models (Claude, GPT, Gemini, Grok, DeepSeek), paid from your OpenFinance AI credits.',
    how: 'The credit balance shows under the Jarvis name after every answer.',
  },
  {
    name: 'Your account',
    what: 'Reads your balance, positions, open orders and fills, and shows your deposit address.',
    how: 'Nothing to do: it appears as soon as the key is added.',
  },
]

const KEY_RULES: Row[] = [
  {
    name: 'Never share it',
    what: 'Anyone who has your key can spend your AI credits, trade with your money and withdraw your funds.',
    how: 'Do not paste it in chats, screenshots, issues or anyone else\u2019s site.',
  },
  {
    name: 'Host your copy privately',
    what: 'Deploy this terminal to your own private Vercel project, for you alone.',
    how: 'If you share the site, every visitor must use their own key; never hand yours over or let others trade on it.',
  },
  {
    name: 'Keep it out of the code',
    what: 'The key belongs only in the field on this page, which keeps it in this browser tab and nowhere else.',
    how: 'Never put it in the code, in Vercel environment variables or in a link. Close the tab or press Forget key when done.',
  },
  {
    name: 'If it leaks, revoke it',
    what: 'A leaked key works until you revoke it.',
    how: 'Revoke it on openfinance.tech straight away and create a new one.',
  },
]

const DEX_ROWS: Row[] = [
  {
    name: 'Trade ticket',
    what: 'Market orders on any Hyperliquid perp: crypto, plus stocks, indices, commodities and FX. Orders go from your own OpenFinance account.',
    how: 'Pick Long or Short, enter a size in USDC or in coins (⇅ switches, the slider sizes from your balance), press the button, then confirm.',
  },
  {
    name: 'Leverage and margin',
    what: 'Cross uses your whole balance as collateral; Isolated limits the risk to this position’s margin. Leverage goes up to the market’s maximum.',
    how: 'Tap Cross to switch mode, tap the leverage button for the slider. Both are applied just before each order.',
  },
  {
    name: 'TP/SL and Reduce only',
    what: 'Take-profit and stop-loss close the position at market when price gets there. Reduce only can only shrink a position, never grow it.',
    how: 'Tick TP/SL and type both prices. Ask Jarvis for a plan first if you want levels to start from.',
  },
  {
    name: 'Before you send',
    what: 'Estimated liquidation price, order value and margin, live. Every order has a confirm step and fills at market with at most 1% slippage. Minimum $10.',
    how: 'Read the confirm box: it is exactly what will be sent. Change anything and it closes, so you always confirm what you see.',
  },
  {
    name: 'Balance and Deposit',
    what: 'Balance and what is available to trade, straight from your Hyperliquid account. Deposit shows your Hyperliquid address for USDC.',
    how: 'Send USDC on Hyperliquid to that address. To fund from another chain or with a card, use openfinance.tech.',
  },
  {
    name: 'Positions and orders',
    what: 'Positions, balances, open orders and fill history appear under the chart once your key is added.',
    how: 'Close a position or cancel an order in one click from those tabs.',
  },
]

const UPGRADE_ROWS: Row[] = [
  {
    name: 'Limit orders',
    what: 'Rest an order at your price instead of taking the market.',
    how: '“Add a Limit tab to the trade ticket with a price field and a Mid button that sends Gtc limit orders, and list resting orders in Open Orders.”',
  },
  {
    name: 'TWAP',
    what: 'Split a big order into slices over time to soften its impact.',
    how: '“Add a TWAP tab that splits the order over N minutes with OpenFinance’s agent/trading/twap route, and allow that route in api/_allow.ts.”',
  },
  {
    name: 'Alerts',
    what: 'Get told when price reaches a level, without staring at the chart.',
    how: '“Send me a browser notification when price touches the buy or sell area on the open chart.”',
  },
  {
    name: 'Your own indicator',
    what: 'Add the tool you trade with, and have Jarvis understand it.',
    how: '“Add a VWAP indicator with an on/off toggle and an explainer, and include its reading in Jarvis’ context.”',
  },
  {
    name: 'Your defaults and look',
    what: 'Make it feel like your desk.',
    how: '“Make Claude Sonnet 5.5 Jarvis’ default model, default to 10x isolated, and change the accent colour to green.”',
  },
]

const JARVIS_USE_ROWS: Row[] = [
  {
    name: 'Read the chart',
    what: 'A plain-English walkthrough of every indicator that is on, with the live numbers.',
    how: '“Walk me through every indicator on this chart, then give me your overall read.”',
  },
  {
    name: 'Plan a trade',
    what: 'A lean (long, short or wait), entry, stop, target, and the level that proves it wrong.',
    how: '“Should I long here? Give me entry, stop, target and what would make me wrong.” Then set the size and TP/SL in the ticket.',
  },
  {
    name: 'Stress-test your idea',
    what: 'A second opinion that argues the other side before you risk money.',
    how: '“I want to short at 75,800. Argue against it.”',
  },
  {
    name: 'Learn',
    what: 'Concepts explained on the chart in front of you.',
    how: '“Explain RSI divergence using this chart.” · “What does funding tell me right now?”',
  },
  {
    name: 'Anything else',
    what: 'Strategy, risk, macro, other markets, or questions with nothing to do with trading.',
    how: '“How do funding carry trades work and when do they blow up?”',
  },
  {
    name: 'Get better answers',
    what: 'Jarvis reads the market, timeframe and indicators on screen at the moment you ask.',
    how: 'Switch market or timeframe, turn on the indicators you care about, then ask. Start on a fast model; switch to Sonnet, Terra or Opus for decisions that matter.',
  },
  {
    name: 'Know its limits',
    what: 'It cannot see your account or place orders, has no live news, and can be wrong.',
    how: 'Treat it as a sharp second opinion. Check the levels yourself and size every trade so being wrong is affordable.',
  },
]

const TOOL_ROWS: Row[] = [
  {
    name: 'Markets and the chart',
    what: 'Every Hyperliquid perp, with live candles, mark and oracle price, 24h volume, open interest and the hourly funding rate with a countdown.',
    how: 'Pick the market from the pair button and the timeframe above the chart (the arrow opens every interval up to 1 month). Share (camera icon, top right of the chart) saves a picture of the chart.',
  },
  ...INDICATOR_ORDER.map((k) => ({
    name: EXPLAINERS[k].name,
    what: EXPLAINERS[k].text,
    how: (
      <ul>
        {EXPLAINERS[k].how.map((h, i) => (
          <li key={i}>{h}</li>
        ))}
      </ul>
    ),
  })),
  {
    name: 'Key levels to watch',
    what: 'The golden pocket, fib levels, RSI, the nearest buy and sell areas and the bands, all live.',
    how: 'Under the trade ticket; tap to expand. The closed block already shows how far the nearest areas are.',
  },
]

const SAFETY_ROWS: Row[] = [
  {
    name: 'Your key',
    what: 'It stays only in this browser tab and is sent only to OpenFinance, through the site’s own server.',
    how: 'Forget key, or closing the tab, removes it. See section 01 for the rules.',
  },
  {
    name: 'What the server forwards',
    what: 'Only what this page needs: AI answers, your credit balance, your deposit address, leverage, orders and cancels. It keeps no copy; separately it counts anonymous page visits.',
    how: 'Withdrawals and transfers are blocked, so even a bug here could not move your funds out.',
  },
  {
    name: 'Market data',
    what: 'Prices and candles are Hyperliquid’s public data, streamed to your browser. Indicators are computed in your browser from the candles you see.',
    how: 'No login: the chart needs nothing, the AI and trading need only your key.',
  },
  {
    name: 'Not advice',
    what: 'Indicators describe what price has done, not what it will do. Jarvis is not financial advice.',
    how: 'Size every trade so that being wrong is affordable.',
  },
]

function Rows({ head, rows }: { head: [string, string, string]; rows: Row[] }) {
  return (
    <div className="hiw-table" role="table">
      <div className="hiw-tr hiw-th" role="row">
        {head.map((h) => (
          <span key={h} role="columnheader">
            {h}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div className="hiw-tr" role="row" key={r.name}>
          <span className="hiw-name" role="cell">
            <i>{String(i + 1).padStart(2, '0')}</i>
            {r.name}
          </span>
          <span className="hiw-what" role="cell">
            {r.what}
          </span>
          <span className="hiw-how" role="cell">
            {r.how}
          </span>
        </div>
      ))}
    </div>
  )
}

function Section({ n, id, title, lead, children }: { n: string; id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section className="hiw-sec" id={`hiw-${id}`}>
      <div className="hiw-sec-head">
        <span className="hiw-num">{n}</span>
        <div>
          <h2>{title}</h2>
          <p>{lead}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

export function HowItWorks({ onOpenTerminal }: { onOpenTerminal: () => void }) {
  return (
    <div className="hiw">
      <div className="hiw-inner">
        <header className="hiw-hero">
          <div className="hiw-eyebrow">Guide</div>
          <h1>How your Self-Hosted Perp DEX works</h1>
          <p>
            Your own trading station on Hyperliquid, with an AI that reads your chart and the tools to plan every trade
            before you place it.
          </p>
          <nav className="hiw-index">
            <a href="#hiw-key">01 Your OpenFinance key</a>
            <a href="#hiw-dex">02 Your DEX</a>
            <a href="#hiw-jarvis">03 Jarvis</a>
            <a href="#hiw-tools">04 Chart and tools</a>
            <a href="#hiw-safety">05 Data and safety</a>
          </nav>
        </header>

        <Section
          n="01"
          id="key"
          title="Your OpenFinance key"
          lead={
            <>
              One key, starting with <code className="hiw-code">open_</code>, gives this terminal both trading and
              AI. Get it on openfinance.tech and paste it into the trade ticket or Jarvis.
            </>
          }
        >
          <Rows head={['It unlocks', 'What it does', 'Where']} rows={KEY_ROWS} />
          <div className="hiw-warn" role="note">
            <b>Treat it like the keys to your account.</b> Whoever holds it can use your AI credits, trade, and
            withdraw your funds. Keep it to yourself and run your own copy on a private Vercel project.
          </div>
          <Rows head={['Rule', 'Why', 'What to do']} rows={KEY_RULES} />
        </Section>

        <Section
          n="02"
          id="dex"
          title="Your DEX"
          lead="A personal trading station on Hyperliquid, running on your OpenFinance account. Add your key and the right-hand panel trades for real."
        >
          <Rows head={['Part', 'What it does', 'How to use it']} rows={DEX_ROWS} />
          <div className="hiw-sub">
            <h3>Make it yours</h3>
            <p>
              This terminal is your own copy: the code lives in your GitHub and deploys to your Vercel, so you can
              upgrade, edit and change anything. Describe the change in plain words to the AI that builds it for you.
              Some places to start:
            </p>
          </div>
          <Rows head={['Upgrade', 'Why', 'Ask your AI builder']} rows={UPGRADE_ROWS} />
        </Section>

        <Section
          n="03"
          id="jarvis"
          title="Jarvis, your own AI"
          lead="Add your OpenFinance key and Jarvis runs top AI models on the live readings of the chart you have open, and answers anything else too. Answers are paid from your OpenFinance AI credits; the balance shows under the Jarvis name. Without a key it uses a free built-in engine."
        >
          <div className="hiw-table hiw-models" role="table">
            <div className="hiw-tr hiw-th" role="row">
              <span role="columnheader">Model</span>
              <span role="columnheader">Best for</span>
              <span role="columnheader">Speed</span>
              <span role="columnheader">Cost</span>
            </div>
            {AI_MODELS.map((m, i) => (
              <div className="hiw-tr" role="row" key={m.id}>
                <span className="hiw-name" role="cell">
                  <i>{String(i + 1).padStart(2, '0')}</i>
                  {m.label}
                  {i === 0 && <em className="hiw-tag">default</em>}
                </span>
                <span className="hiw-what" role="cell">
                  {m.bestFor}
                </span>
                <span className="hiw-mono" role="cell">
                  {m.speed}
                </span>
                <span className="hiw-mono hiw-cost" role="cell">
                  {costLabel(m.cost)}
                  <span>{'$'.repeat(4 - m.cost)}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="hiw-note">
            Pick the model from the menu in the Jarvis panel; your choice is remembered. Speeds are typical for a
            trade-plan answer.
          </p>
          <div className="hiw-sub">
            <h3>How to get the most out of it</h3>
          </div>
          <Rows head={['Use it to', 'What you get', 'Try asking']} rows={JARVIS_USE_ROWS} />
        </Section>

        <Section
          n="04"
          id="tools"
          title="Chart and tools"
          lead="Five indicators you can switch on and off above the chart (the ⓘ next to each explains it), plus the key levels."
        >
          <Rows head={['Tool', 'What it shows', 'How to use it']} rows={TOOL_ROWS} />
        </Section>

        <Section n="05" id="safety" title="Data and safety" lead="What leaves your browser, and what never can.">
          <Rows head={['Topic', 'How it works', 'What it means for you']} rows={SAFETY_ROWS} />
        </Section>

        <div className="hiw-foot">
          <button className="hiw-cta" onClick={onOpenTerminal}>
            Open the terminal
          </button>
        </div>
      </div>
    </div>
  )
}
