import { useCallback, useState, type ReactNode } from 'react'
import { PrivacyContext, readStoredPrivacy, storePrivacy } from './privacy'

/** Must wrap DashboardProvider. */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readStoredPrivacy)
  const toggle = useCallback(() => {
    const next = !hidden
    storePrivacy(next)
    setHidden(next)
  }, [hidden])
  return <PrivacyContext.Provider value={{ hidden, toggle }}>{children}</PrivacyContext.Provider>
}
