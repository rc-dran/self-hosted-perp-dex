// The visitor's OpenFinance key. It lives only in this tab's sessionStorage:
// never in code, env, the bundle or any log, and it is gone when the tab closes.
// Jarvis and the trade ticket share it (one key per OpenFinance account); both
// send it per request to the same-origin pass-through (/api/of), which forwards
// it to api.openfinance.tech and nowhere else.

import { useSyncExternalStore } from 'react'

const KEY = 'tia.openfinance.key'
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function getOfKey(): string {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setOfKey(k: string): void {
  try {
    sessionStorage.setItem(KEY, k.trim())
  } catch {
    /* private mode: the key just won't persist across reloads */
  }
  notify()
}

export function clearOfKey(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  notify()
}

/** The current key ('' when none); re-renders when it is added or removed. */
export function useOfKey(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getOfKey,
  )
}

export const looksLikeOfKey = (k: string) => /^open_[A-Za-z0-9_-]{8,}$/.test(k.trim())
