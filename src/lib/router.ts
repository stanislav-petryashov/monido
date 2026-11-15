import { useSyncExternalStore } from 'react'

interface PendingNavigation { commit: () => void; allowed?: boolean }

const POSITION = '__familyFinancePosition'
const guards = new Set<() => Promise<boolean>>()
const listeners = new Set<() => void>()
let listening = false
let path = ''
let position = 0
let checking = false
let navigating: PendingNavigation | null = null
let traversal: { target: number; phase: 'restore' | 'confirm' | 'replay'; allowed?: boolean } | null = null

const historyPosition = (): number | undefined => window.history.state?.[POSITION]
const stateAt = (at: number) => ({ ...window.history.state, [POSITION]: at })

function publish() {
  path = window.location.pathname
  position = historyPosition() ?? position
  for (const listener of listeners) listener()
}

function start() {
  if (listening) return
  position = historyPosition() ?? 0
  window.history.replaceState(stateAt(position), '')
  path = window.location.pathname
  window.addEventListener('popstate', onPop)
  listening = true
}

function stopIfUnused() {
  if (listeners.size || guards.size) return
  window.removeEventListener('popstate', onPop)
  listening = false
  traversal = null
  navigating = null
}

/** Register a departure check; removing it invalidates an outstanding answer from that owner. */
export function registerNavigationGuard(guard: () => Promise<boolean>): () => void {
  start()
  guards.add(guard)
  return () => { guards.delete(guard); stopIfUnused() }
}

/** The same departure check for local setup steps. Repeated attempts during a question are ignored. */
export async function confirmNavigation(): Promise<boolean> {
  if (checking) return false
  checking = true
  try {
    for (const guard of [...guards]) {
      if (!guards.has(guard) || !(await guard()) || !guards.has(guard)) return false
    }
    return true
  } catch {
    return false
  } finally {
    checking = false
  }
}

function finishTraversal(attempt: NonNullable<typeof traversal>) {
  // A second browser click may still be returning to the committed position when the answer arrives.
  if (traversal !== attempt || attempt.allowed === undefined || historyPosition() !== position) return
  if (attempt.allowed) {
    attempt.phase = 'replay'
    window.history.go(attempt.target - position)
  } else traversal = null
}

function finishNavigation(attempt: PendingNavigation) {
  // An internal approval may arrive while Back/Forward is returning to this route.
  if (navigating !== attempt || attempt.allowed === undefined || historyPosition() !== position) return
  navigating = null
  if (attempt.allowed) attempt.commit()
}

function onPop() {
  const next = historyPosition()
  if (navigating) {
    // The internal destination owns the pending question; browser clicks only restore its starting position.
    if (next !== undefined && next !== position) window.history.go(position - next)
    else finishNavigation(navigating)
    return
  }
  if (traversal) {
    if (traversal.phase === 'replay' && next === traversal.target) {
      traversal = null
      publish()
    } else if (next !== undefined && next !== position) {
      // Back/Forward may be pressed again during restoration or the question.
      window.history.go(position - next)
    } else if (traversal.phase === 'restore') {
      const attempt = traversal
      attempt.phase = 'confirm'
      void confirmNavigation().then(allowed => {
        attempt.allowed = allowed
        finishTraversal(attempt)
      })
    } else if (traversal.phase === 'confirm') finishTraversal(traversal)
    return
  }
  // Every same-document entry created by this router is indexed. A cross-document departure
  // is handled by beforeunload; an unindexed pop from another history owner remains theirs.
  if (next === undefined || next === position || guards.size === 0) {
    publish()
    return
  }
  traversal = { target: next, phase: 'restore' }
  window.history.go(position - next)
}

function subscribe(onChange: () => void): () => void {
  start()
  listeners.add(onChange)
  return () => { listeners.delete(onChange); stopIfUnused() }
}

const currentPath = () => listening ? path : window.location.pathname

/** The committed path: a pending browser traversal never unmounts the current editor. */
export function useRoute(): string {
  return useSyncExternalStore(subscribe, currentPath)
}

/** A navigation without a reload; replace adds no history entry (redirects). */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): void {
  start()
  if (to === window.location.pathname || navigating || traversal) { stopIfUnused(); return }
  const commit = () => {
    if (replace) window.history.replaceState(stateAt(position), '', to)
    else window.history.pushState({ [POSITION]: position + 1 }, '', to)
    publish()
    stopIfUnused()
  }
  if (guards.size === 0) { commit(); return }
  const attempt: PendingNavigation = { commit }
  navigating = attempt
  void confirmNavigation().then(allowed => {
    attempt.allowed = allowed
    finishNavigation(attempt)
  })
}
