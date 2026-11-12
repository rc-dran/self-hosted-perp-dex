import { useEffect, useId, useRef, useState } from 'react'
import type { Candle, Interval } from '../lib/hyperliquid'
import type { PerpAsset } from '../lib/universe'
import type { IndicatorSel } from './Chart'
import { buildContext, heuristicAnswer, aiMessages, EXPLAINERS } from '../lib/jarvis'
import { AI_MODELS, AiError, fetchCredits, getModel, saveModel, streamChat, type AiModel, type ChatMsg } from '../lib/llm'
import { clearOfKey, getOfKey, useOfKey } from '../lib/ofkey'
import { openKeyModal } from '../lib/keyModal'

interface Msg {
  from: 'user' | 'jarvis'
  text: string
  /** answered by the AI (vs the built-in engine): the model's label */
  ai?: string
  /** a filter toggle narrated as a quiet event line; `detail` is the explainer shown on demand */
  event?: { on: boolean; detail?: string }
  /** the AI could not answer; `text` says why and what to do */
  error?: boolean
}

/** Relative price as $ to $$$$: the paid part bright, the rest dim. */
function Cost({ c }: { c: number }) {
  return (
    <span className="jv-cost" aria-label={`cost ${c} of 4`}>
      <b>{'$'.repeat(c)}</b>
      {'$'.repeat(4 - c)}
    </span>
  )
}

const Chevron = () => (
  <svg className="jv-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Model picker: a button that opens a listbox popover (arrow keys, Home/End, Enter, Escape). */
function ModelPicker({ model, onChange }: { model: AiModel; onChange: (m: AiModel) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const uid = useId()

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, AI_MODELS.findIndex((m) => m.id === model.id)))
    listRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function close() {
    setOpen(false)
    btnRef.current?.focus()
  }

  function pick(m: AiModel) {
    onChange(m)
    close()
  }

  function onListKey(e: React.KeyboardEvent) {
    const last = AI_MODELS.length - 1
    const moves: Record<string, (i: number) => number> = {
      ArrowDown: (i) => Math.min(last, i + 1),
      ArrowUp: (i) => Math.max(0, i - 1),
      Home: () => 0,
      End: () => last,
    }
    if (moves[e.key]) {
      e.preventDefault()
      setActive(moves[e.key])
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(AI_MODELS[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="jv-model" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`jv-model-btn ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`AI model: ${model.label}`}
        title={model.bestFor}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="jv-model-k">Model</span>
        <span className="jv-model-name">{model.label}</span>
        <Cost c={model.cost} />
        <span className="jv-model-speed">{model.speed}</span>
        <Chevron />
      </button>
      {open && (
        <ul
          ref={listRef}
          className="jv-model-list"
          role="listbox"
          tabIndex={-1}
          aria-label="AI model"
          aria-activedescendant={`${uid}-${active}`}
          onKeyDown={onListKey}
        >
          {AI_MODELS.map((m, i) => (
            <li
              key={m.id}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={m.id === model.id}
              className={`jv-opt ${i === active ? 'active' : ''} ${m.id === model.id ? 'sel' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(m)}
            >
              <div className="jv-opt-top">
                <span className="jv-opt-name">{m.label}</span>
                <Cost c={m.cost} />
                <span className="jv-opt-speed">{m.speed}</span>
              </div>
              <div className="jv-opt-best">{m.bestFor}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const QUICK = [
  { label: 'Should I trade?', q: 'Should I trade?' },
  { label: 'Why?', q: 'why?' },
  { label: 'Explain bands', q: 'Explain the EMA bands' },
  { label: 'Explain zones', q: 'Where are the buy and sell areas?' },
]

/** Models sometimes add **bold** or "## " headings despite the plain-text rule:
    show bold as bold and drop heading marks instead of printing raw markdown. */
function richText(text: string) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .split(/(\*\*[^*\n]+\*\*)/)
    .map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part))
}

type KeyState = { status: 'none' } | { status: 'checking' } | { status: 'ready'; credits: number } | { status: 'error'; message: string }

export function Jarvis({
  asset,
  interval,
  candles,
  sel,
}: {
  asset: PerpAsset
  interval: Interval
  candles: Candle[] | null
  sel: IndicatorSel
}) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: 'jarvis',
      text: "Jarvis online. I read the filters on this chart. Toggle one and I'll explain it, or ask me if the setup is worth trading. Connect your OpenFinance key (top right) to switch me to real AI, then ask me anything about trading.",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useOfKey() // shared with the trade ticket: one key per account
  const [keyState, setKeyState] = useState<KeyState>({ status: 'none' })
  const [model, setModel] = useState<AiModel>(getModel)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevSelRef = useRef<IndicatorSel>(sel)
  const historyRef = useRef<ChatMsg[]>([]) // AI conversation turns (question + answer), without the live context
  const abortRef = useRef<AbortController | null>(null)

  const aiOn = keyState.status === 'ready'

  // whenever a key is added (here or in the trade ticket) check it; when it is removed, drop back
  useEffect(() => {
    if (key) {
      void checkKey(key)
    } else {
      abortRef.current?.abort()
      historyRef.current = []
      setKeyState((s) => (s.status === 'error' ? s : { status: 'none' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function checkKey(k: string) {
    setKeyState({ status: 'checking' })
    try {
      const credits = await fetchCredits()
      if (getOfKey() === k) setKeyState({ status: 'ready', credits })
    } catch (e) {
      if (getOfKey() !== k) return
      const message = e instanceof AiError ? e.message : "Couldn't reach OpenFinance just now. Check your internet connection and try again."
      setKeyState({ status: 'error', message })
      if (e instanceof AiError && (e.status === 401 || e.status === 403)) clearOfKey()
    }
  }

  const forgetKey = () => clearOfKey()

  // narrate filter toggles with the built-in engine (instant, never spends credits)
  useEffect(() => {
    const prev = prevSelRef.current
    prevSelRef.current = sel
    const keys = Object.keys(sel) as (keyof IndicatorSel)[]
    for (const k of keys) {
      if (sel[k] !== prev[k]) {
        const e = EXPLAINERS[k]
        if (sel[k]) {
          const ctx = candles ? buildContext(asset.sym, interval, candles, sel) : null
          const live = ctx ? `\n\n${heuristicAnswer(`explain ${k}`, ctx).split('\n\n').slice(-1)[0]}` : ''
          push({ from: 'jarvis', text: e.name, event: { on: true, detail: `${e.text}${live}` } })
        } else {
          push({ from: 'jarvis', text: e.name, event: { on: false } })
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs])

  function push(m: Msg) {
    setMsgs((prev) => [...prev.slice(-60), m])
  }

  async function ask(q: string) {
    if (!q.trim() || busy) return
    push({ from: 'user', text: q })
    setInput('')
    const ctx = candles?.length ? buildContext(asset.sym, interval, candles, sel) : null
    if (!ctx) {
      push({ from: 'jarvis', text: 'Candles are still loading, give me a second.' })
      return
    }
    if (!aiOn) {
      push({ from: 'jarvis', text: heuristicAnswer(q, ctx) })
      return
    }

    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    // an empty AI bubble that fills in as the answer streams
    setMsgs((prev) => [...prev.slice(-60), { from: 'jarvis', text: '', ai: model.label }])
    const append = (piece: string) =>
      setMsgs((prev) => {
        const next = prev.slice()
        const last = next[next.length - 1]
        next[next.length - 1] = { ...last, text: last.text + piece }
        return next
      })
    try {
      const { text: answer, cut, stopped } = await streamChat(model, aiMessages(q, ctx, historyRef.current), append, controller.signal)
      if (stopped) append('\n\n(The answer stopped early because the connection dropped. Ask again for the rest.)')
      else if (cut) append('\n\n(The answer hit the length limit. Ask "continue" for the rest.)')
      historyRef.current = [...historyRef.current, { role: 'user' as const, content: q }, { role: 'assistant' as const, content: answer }].slice(-8)
      fetchCredits().then((credits) => setKeyState({ status: 'ready', credits }), () => {})
    } catch (e) {
      if (controller.signal.aborted) return
      const reason = e instanceof AiError ? e.message : `${model.label} couldn't answer this time. Ask again, or pick another model from the menu.`
      if (e instanceof AiError && (e.status === 401 || e.status === 403)) forgetKey()
      // replace the empty bubble with a plain explanation (no stand-in answer)
      setMsgs((prev) => {
        const next = prev.slice()
        next[next.length - 1] = { from: 'jarvis', text: reason, error: true }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  const status =
    keyState.status === 'ready'
      ? `AI · ${keyState.credits.toFixed(1)} credits`
      : keyState.status === 'checking'
        ? 'checking key…'
        : 'built-in engine'

  const typing = (
    <span className="jv-typing" aria-label="thinking">
      <i />
      <i />
      <i />
    </span>
  )

  return (
    <aside className="jarvis">
      <div className="jv-head">
        <span className={`jv-orb ${aiOn ? 'ai' : ''}`} />
        <div className="jv-head-text">
          <div className="jv-title">Jarvis</div>
          <div className="jv-sub" title={aiOn ? `Answers by ${model.label} via OpenFinance` : undefined}>
            <span>
              {asset.base} {interval}
            </span>
            <span className={`jv-status ${aiOn ? 'ai' : ''}`}>{status}</span>
          </div>
        </div>
        {aiOn ? (
          <button className="jv-key-btn ghost" onClick={forgetKey} title="Remove the key from this tab (also disconnects trading)">
            Forget key
          </button>
        ) : (
          <button className="jv-key-btn" onClick={openKeyModal}>
            Use real AI
          </button>
        )}
      </div>

      {aiOn && (
        <ModelPicker
          model={model}
          onChange={(m) => {
            setModel(m)
            saveModel(m.id)
          }}
        />
      )}

      {keyState.status === 'error' && (
        <div className="jv-key-err-row">
          <span>{keyState.message}</span>
          <button onClick={openKeyModal}>Update key</button>
        </div>
      )}

      <div className="jv-scroll" ref={scrollRef}>
        {msgs.map((m, i) =>
          m.event ? (
            <div
              key={i}
              className={`jv-event ${m.event.on ? 'on' : 'off'}`}
              title={m.event.on ? undefined : `${m.text} removed from the chart and from my confluence read.`}
            >
              {m.event.detail ? (
                <details>
                  <summary>
                    <span className="jv-event-dot" />
                    <span className="jv-event-name">{m.text}</span>
                    <span className="jv-event-state">ON</span>
                    <span className="jv-event-more">Details</span>
                  </summary>
                  <div className="jv-event-detail">{m.event.detail}</div>
                </details>
              ) : (
                <div className="jv-event-row">
                  <span className="jv-event-dot" />
                  <span className="jv-event-name">{m.text}</span>
                  <span className="jv-event-state">{m.event.on ? 'ON' : 'OFF'}</span>
                </div>
              )}
            </div>
          ) : (
            <div key={i} className={`jv-msg ${m.from} ${m.ai ? 'ai' : ''} ${m.error ? 'error' : ''}`} role={m.error ? 'alert' : undefined}>
              {m.error && <span className="jv-err-tag">Couldn't answer</span>}
              {m.ai && <span className="jv-ai-tag">AI · {m.ai}</span>}
              {m.text ? <div className="jv-text">{m.ai ? richText(m.text) : m.text}</div> : busy && i === msgs.length - 1 ? typing : null}
            </div>
          ),
        )}
        {busy && !aiOn && <div className="jv-msg jarvis">{typing}</div>}
      </div>
      <div className="jv-foot">
        <div className="jv-quick">
          {QUICK.map((c) => (
            <button key={c.label} className="jv-chip" onClick={() => ask(c.q)} disabled={busy}>
              {c.label}
            </button>
          ))}
        </div>
        <form
          className="jv-input-row"
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
        >
          <input
            placeholder={aiOn ? 'Ask Jarvis anything…' : 'Ask Jarvis about the setup…'}
            aria-label="Message Jarvis"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="jv-send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  )
}
