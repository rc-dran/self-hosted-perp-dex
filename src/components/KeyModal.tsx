import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clearOfKey, looksLikeOfKey, setOfKey, useOfKey } from '../lib/ofkey'
import { closeKeyModal, useKeyModalOpen } from '../lib/keyModal'

/* The one place to add, view or remove the OpenFinance key. Rendered into
   document.body so it always sits above the terminal's panels. */
export function KeyModal() {
  const isOpen = useKeyModalOpen()
  const key = useOfKey()
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setDraft('')
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeKeyModal()
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  if (!isOpen) return null

  const masked = key ? `open_••••${key.slice(-4)}` : ''

  return createPortal(
    <div className="modal-overlay" onClick={closeKeyModal}>
      <div className="modal-card km" role="dialog" aria-modal="true" aria-labelledby="km-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="km-title">{key ? 'Your OpenFinance key' : 'Connect your OpenFinance key'}</h3>
          <button className="modal-x" onClick={closeKeyModal} aria-label="Close">
            ×
          </button>
        </div>
        <p className="km-lead">One key turns this terminal into your own trading desk.</p>

        <ol className="km-perks">
          <li>
            <span className="km-num">1</span>
            <div>
              <b>Trade perpetuals</b>
              <p>
                Trade Hyperliquid perpetuals right from this terminal: crypto, stocks, commodities and FX, with leverage,
                TP/SL and a confirmation before every order.
              </p>
            </div>
          </li>
          <li>
            <span className="km-num">2</span>
            <div>
              <b>Power Jarvis with top AI models</b>
              <p>
                The same key runs Jarvis on leading models such as Claude, GPT, Gemini and Grok, so you get a second
                opinion on every setup. Answers are paid from your OpenFinance AI credits.
              </p>
            </div>
          </li>
        </ol>

        {key ? (
          <div className="km-connected">
            <span className="km-dot" />
            <span>
              Connected <code>{masked}</code>
            </span>
            <button className="km-forget" onClick={clearOfKey}>
              Forget key
            </button>
          </div>
        ) : (
          <>
            <form
              className="km-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!looksLikeOfKey(draft)) return
                setOfKey(draft)
                setDraft('')
                closeKeyModal()
              }}
            >
              <input
                ref={inputRef}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your key (open_…)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" disabled={!looksLikeOfKey(draft)}>
                Connect
              </button>
            </form>
            <p className="km-get">
              No key yet?{' '}
              <a href="https://openfinance.tech" target="_blank" rel="noreferrer">
                Create one on openfinance.tech
              </a>
            </p>
          </>
        )}

        <div className="km-warn" role="note">
          <b>Never share this key.</b> Anyone who has it can spend your AI credits, trade and withdraw your funds. Use it
          only on your own copy of this terminal, hosted privately, and revoke it on openfinance.tech if it leaks. This
          page keeps it only in this browser tab and can never withdraw with it.
        </div>
      </div>
    </div>,
    document.body,
  )
}
