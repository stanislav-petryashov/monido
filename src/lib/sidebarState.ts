import { useCallback, useState } from 'react'
import { readItem, writeItem } from './storage'

/** The localStorage key of the compact (icons-only) side menu: per browser, not a family setting. @public */
export const SIDEBAR_STORAGE_KEY = 'fc.sidebar'

/** Whether the side menu is compact; it is drawn only after React mounts, so the saved choice is read once, without a flash. */
export function useSidebarCompact(): [boolean, () => void] {
  const [compact, setCompact] = useState(() => readItem('local', SIDEBAR_STORAGE_KEY) === 'compact')
  const toggle = useCallback(() => {
    setCompact(prev => {
      writeItem('local', SIDEBAR_STORAGE_KEY, prev ? null : 'compact')
      return !prev
    })
  }, [])
  return [compact, toggle]
}
