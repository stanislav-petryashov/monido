import { useSyncExternalStore } from 'react'

const CHANGE = 'query-address'
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify)
  window.addEventListener(CHANGE, notify)
  return () => { window.removeEventListener('popstate', notify); window.removeEventListener(CHANGE, notify) }
}

export function useQuerySearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search)
}

/** Change only the named parameters, preserving route state, hash and unrelated parameters. */
export function setQueryParams(change: Record<string, string | null>, push = false): void {
  const q = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(change)) {
    if (value === null) q.delete(key)
    else q.set(key, value)
  }
  const query = q.toString()
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history[push ? 'pushState' : 'replaceState'](window.history.state, '', url)
  window.dispatchEvent(new Event(CHANGE))
}
