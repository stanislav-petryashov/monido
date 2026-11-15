import { useEffect, useState } from 'react'

/** The phone layout: the one width the stylesheets' `@media (max-width: 640px)` use too */
export const PHONE = '(max-width: 640px)'

/**
 * A media query subscription. Safari ≤ 13 knows only addListener: without the fallback
 * addEventListener throws and brings the tree down.
 */
export function onMediaChange(query: string, onChange: (matches: boolean) => void): () => void {
  const media = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined
  if (!media) return () => {}
  const listener = (e: { matches: boolean }) => onChange(e.matches)
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }
  media.addListener(listener)
  return () => media.removeListener(listener)
}

/** Whether the window matches the media query now; false without matchMedia (SSR, an old browser). */
export function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
}

/** true while the window matches the media query; follows changes. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaMatches(query))
  useEffect(() => onMediaChange(query, setMatches), [query])
  return matches
}
