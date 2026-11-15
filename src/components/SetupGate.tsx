import { Suspense, type ReactNode } from 'react'
import { lazyWithChunks } from '../i18n/lazyWithChunks'
import { useAuth } from '../lib/authState'
import { useCanRunSetup } from '../lib/rights'
import { LogoMark } from './layout/LogoMark'
import { ThemeToggle } from './layout/ThemeToggle'
import { UserMenu } from './layout/UserMenu'
import { Loading } from './ui/Loading'

// lazy with the records chunk: the wizard's texts and the reused Records blocks' arrive with it, and the first bundle stays as it is
const SetupScreen = lazyWithChunks(() => import('../pages/setup/SetupScreen').then(m => ({ default: m.SetupScreen })), 'records')

/**
 * Between AuthGate and AppShell: while the family's setup is pending and the person may run it (manage and edit, not the
 * demo), the standalone setup screen; otherwise the app. One read of /api/auth decides, so the empty dashboard never flashes.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const { setup } = useAuth()
  const canRun = useCanRunSetup()
  if (setup === 'pending' && canRun) {
    return <Suspense fallback={<Loading />}><SetupScreen brand={<LogoMark />} tools={<><ThemeToggle /><UserMenu /></>} /></Suspense>
  }
  return children
}
