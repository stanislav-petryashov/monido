import { useEffect, useState, type ReactNode, type ComponentType } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import '../../styles/admin.css'
import { refreshSnapshot } from '../../lib/useFinanceData'
import { PageActionSlot } from './ui/pageActionSlot'

interface DataPageProps {
  children?: ReactNode
  /** The route's screen: a core one or a module's */
  screen: ComponentType
  /** The shell can host the action beside the title; undefined keeps the local action row. */
  actionSlot?: HTMLElement | null
}

/**
 * A page of the Data section under the shell's title row: the screen's action row and the table screen. AppShell mounts
 * it anew for each route.
 */
export function DataPage({ screen: Screen, children, actionSlot }: DataPageProps) {
  const queryClient = useQueryClient()
  // the screen's main action ("+ Account") is drawn here through a portal
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  // Edits here change the dashboard snapshot: on leaving the page we mark it stale,
  // so the dashboard refetches /api/snapshot instead of showing a cache up to 5 minutes old.
  useEffect(() => () => { void refreshSnapshot(queryClient) }, [queryClient])

  return (
    <>
      {actionSlot === undefined && <div ref={setSlot} className="page-action-slot" />}
      {children}
      <PageActionSlot.Provider value={actionSlot === undefined ? slot : actionSlot}>
        <Screen />
      </PageActionSlot.Provider>
    </>
  )
}
