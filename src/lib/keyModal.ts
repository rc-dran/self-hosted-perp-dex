// Open/close state of the OpenFinance key popup, so the top bar, the trade
// ticket and Jarvis can all open the same dialog.

import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  open = v
  listeners.forEach((l) => l())
}

export const openKeyModal = () => set(true)
export const closeKeyModal = () => set(false)

export function useKeyModalOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => open,
  )
}
