import { browser } from './browser'

const KEY = 'monido:chunk-reload'
/** A failure this soon after the last reload is not cured by another one: the error screen shows */
const WINDOW_MS = 30_000

/**
 * A part of the app loaded on demand (a page's script or stylesheet) that fails to load, `vite:preloadError`: most often
 * a tab opened before the server was updated (its old files are gone), else a dropped connection. One reload fetches
 * what the server has now; a second failure within WINDOW_MS, or no session storage to remember the first, leaves the
 * error screen with its own "Reload" so a broken server never loops the page. Returns the way to stop listening (tests).
 */
export function reloadOnChunkError(target: Window = window, now: () => number = Date.now): () => void {
  const onError = (event: Event) => {
    try {
      if (now() - (Number(sessionStorage.getItem(KEY)) || 0) < WINDOW_MS) return
      sessionStorage.setItem(KEY, String(now()))
    } catch { return }
    event.preventDefault()
    browser.reload()
  }
  target.addEventListener('vite:preloadError', onError)
  return () => target.removeEventListener('vite:preloadError', onError)
}
