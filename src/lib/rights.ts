import type { Right } from '../domain/api'
import { useAuth } from './authState'

export const RIGHTS: readonly Right[] = ['edit', 'vote', 'manage']

/** Whether the signed-in person has the right. The family password and the demo have all of them. */
export function useCan(right: Right): boolean {
  const { me, mode } = useAuth()
  if (!me) return mode === 'password' || mode === 'demo'
  return me.rights[right]
}

/**
 * Who may run the setup wizard: both the manage and the edit right, and not the demo. Here, not in setup.ts: SetupGate is in
 * the first bundle and needs only this, while setup.ts's reads and writes load with the pages that use them.
 */
export function useCanRunSetup(): boolean {
  const manage = useCan('manage')
  const edit = useCan('edit')
  const demo = useAuth().mode === 'demo'
  return manage && edit && !demo
}
