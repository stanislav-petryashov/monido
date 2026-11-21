import { browser } from './browser'

const KEY = 'monido:chunk-reload'

/**
 * A part of the app loaded on demand (a page's script or stylesheet) that fails to load, `vite:preloadError`: most often
 * a tab opened before the server was updated (its old files are gone), else a dropped connection. The page reloads once
 * per build: the build it reloaded from is remembered, so a reload that brings a newer build may reload again later, and
 * a second failure in the same build, however long it took, leaves the error screen with its own "Reload" (a broken
 * server never loops the page). No session storage to remember it: no reload. `build` names this build (the entry
 * chunk's hashed URL); returns the way to stop listening (tests).
 */
export function reloadOnChunkError(target: Window = window, build: () => string = () => import.meta.url): () => void {
  const onError = (event: Event) => {
    try {
      if (sessionStorage.getItem(KEY) === build()) return
      sessionStorage.setItem(KEY, build())
    } catch { return }
    event.preventDefault()
    browser.reload()
  }
  target.addEventListener('vite:preloadError', onError)
  return () => target.removeEventListener('vite:preloadError', onError)
}
