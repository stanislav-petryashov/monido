// The client parts of modules: routes, Overview and Net worth blocks. Only the browser imports this.
import type { ComponentType } from 'react'
import type { TablerIcon } from '@tabler/icons-react'
import type { TFunction } from 'i18next'
import type { FinanceSnapshot } from '../domain/types'
import type { RouteDef } from '../routes'
import type { AssetRow } from '../lib/types'
import { advisorClient } from './advisor/client'
import { cashflowClient } from './cashflow/client'
import { claudePromptsClient } from './claude-prompts/client'
import { goalsClient } from './goals/client'
import { healthClient } from './health/client'
import { loansClient } from './loans/client'
import { realEstateClient } from './real-estate/client'
import { remindersClient } from './reminders/client'
import { useAuth } from '../lib/authState'
import { moduleMeta } from './catalog'
import type { ModuleKey } from './types'

/** A cell of the Overview's KPI row (a KpiCell); `order` places it among the other modules' cells */
export interface KpiSlot {
  order: number
  Cell: ComponentType
}

/** A card of the Overview's grid; `visible` says before rendering whether the snapshot gives it anything to show */
export interface CardSlot {
  order: number
  Card: ComponentType
  visible?: (s: FinanceSnapshot) => boolean
}

/** A row of the menu's second floor on Overview: something to do, with the page where it is done */
export interface TodoItem {
  key: string
  to: string
  icon: TablerIcon
  label: string
}

/** What a module's block in an account's detail on the Accounts screen gets: the account and the last closed month */
export interface AccountDetailProps {
  account: { name: string; member: string; currency: string }
  lastMonth: string
}

export interface ClientModule {
  key: ModuleKey
  icon: TablerIcon
  routes?: RouteDef[]
  /**
   * Overview blocks: todo — the module's rows under "To do" on the menu's second floor, pure over the snapshot (`fmt` writes
   * money in the family's display currency); todoHook — the same for rows read from the server (called as a hook, once per
   * render of the floor); kpis — cells of the KPI row under the net worth (the core draws none of its own); cards — cards
   * of the grid under the row, beside the core's "Whose assets" (order 10); both sorted by `order` across the modules;
   * yearHref — the address of a finished year, the first module's that gives one
   */
  overview?: {
    todo?: (s: FinanceSnapshot, t: TFunction, fmt: (v: number) => string) => TodoItem[]
    todoHook?: () => TodoItem[]
    kpis?: KpiSlot[]
    cards?: CardSlot[]
    /** A finished calendar year's page (the years comb's year, the December close card); null — this module has none for it */
    yearHref?: (s: FinanceSnapshot, year: number) => string | null
  }
  /** The asset or liability rows this module keeps and the screen of their records: the Assets list links those rows there */
  assetRecords?: { kind: AssetRow['kind'] | 'loan'; path: string }
  /**
   * A block of an account's detail on the Accounts screen, after the core's charts, in CLIENT_MODULES order; it draws
   * nothing when it has nothing for the account. Lazy (the records chunk's keys, the size budgets)
   */
  accountDetail?: ComponentType<AccountDetailProps>
  /**
   * A warning in the sign-in switch dialogs of Family and access (to Telegram and back to the password), above the
   * confirmation: what the switch ends in this module. Lazy; draws nothing when there is nothing to say
   */
  signInSwitchNotice?: ComponentType
}

/** In MODULE_KEYS order: the order of the blocks on Overview. */
export const CLIENT_MODULES: readonly ClientModule[] = [
  cashflowClient, loansClient, realEstateClient, goalsClient, healthClient, claudePromptsClient, advisorClient, remindersClient,
]

/** Every module, but in the public demo those that are `notInDemo`. */
export function clientModules({ demo }: { demo: boolean }): ClientModule[] {
  return CLIENT_MODULES.filter(m => !(demo && moduleMeta(m.key).notInDemo))
}

/** The modules of this installation: `clientModules` for the signed-in mode. */
export function useClientModules(): ClientModule[] {
  return clientModules({ demo: useAuth().mode === 'demo' })
}
