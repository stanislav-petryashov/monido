import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SetupView } from '../../domain/api'
import { t } from '../../i18n/client'
import { useToast } from '../../lib/notifyState'
import { confirmNavigation, navigate } from '../../lib/router'
import { clearStoredStep, STEP_STORAGE_KEY, useSaveSetup, useSetup } from '../../lib/setup'
import { readItem, writeItem } from '../../lib/storage'
import { refreshSnapshot } from '../../lib/useFinanceData'

export type StepKey = 'welcome' | 'data' | 'members' | 'currencies'

/** The same four steps on first run and on a repeat setup. */
export const STEP_KEYS: readonly StepKey[] = ['welcome', 'data', 'members', 'currencies']

export interface SetupWizard {
  /** the steps of this instance in order; [] until GET /api/setup settles */
  steps: readonly StepKey[]
  step: StepKey
  /** 1-based among `steps`; count = steps.length */
  index: number
  count: number
  again: boolean
  setup: SetupView | undefined
  /** Moves without writing; each one keeps the step's key in sessionStorage. `jump` goes only to a step before the current one. */
  next(): void
  back(): void
  jump(key: StepKey): void
  /** GET /api/setup failed at the start; offer a retry without changing the steps */
  readFailed: boolean
  /** Reads the setup state again */
  retryReads(): void
  /** Marks the setup done, refreshes the snapshot and opens `target`; a failed write stays with a toast. */
  finish(target: string): Promise<void>
  /** Marks the setup skipped and opens the dashboard; a failed write stays with a toast. */
  skip(): Promise<void>
}

/** The step whose heading the wizard last focused; module-level, so it outlives the remount a language switch causes. */
let focusedStep: StepKey | null = null

/**
 * Records `step` as the focused one; true when it differs from the last (a real step change, or a new run), false for a
 * remount on the same step, which moves neither the focus nor the scroll.
 */
export function markFocused(step: StepKey): boolean {
  const changed = focusedStep !== step
  focusedStep = step
  return changed
}

/** Forgets the focused step: a finished run, or a re-run leaving, so the next wizard's first mount focuses its heading. */
export function forgetFocused(): void {
  focusedStep = null
}

/** Keeps the current step for the tab. Obsolete stored keys reopen Welcome. */
export function useSetupWizard({ again }: { again: boolean }): SetupWizard {
  const setup = useSetup()
  const save = useSaveSetup()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [stored] = useState(() => readItem('session', STEP_STORAGE_KEY))
  const [current, setCurrent] = useState<StepKey | null>(null)

  const list = setup.isPending ? [] : STEP_KEYS
  const restored = list.find(key => key === stored)
  const step: StepKey = current ?? restored ?? 'welcome'
  const at = list.indexOf(step)

  function go(key: StepKey | undefined) {
    if (!key) return
    writeItem('session', STEP_STORAGE_KEY, key)
    setCurrent(key)
  }

  async function leave(state: 'done' | 'skipped', target: string, done: string): Promise<void> {
    try {
      await save.mutateAsync(state)
    } catch (e) {
      toast.error(t('data.common.saveFailed'), e)
      return
    }
    // at once: the PUT re-read /api/auth, so on the first run the gate is already swapping to the shell at the current address;
    // the snapshot refetch is not awaited, or that page would show for a round trip before the target
    clearStoredStep()
    forgetFocused()
    navigate(target)
    if (state === 'done') void refreshSnapshot(queryClient)
    toast.success(done)
  }

  return {
    steps: list,
    step,
    index: at + 1,
    count: list.length,
    again,
    setup: setup.data,
    readFailed: setup.isError && !setup.data,
    retryReads: () => { void setup.refetch() },
    next: () => go(list[at + 1]),
    back: () => { if (at > 0) void confirmNavigation().then(allowed => { if (allowed) go(list[at - 1]) }) },
    jump: key => {
      if (list.indexOf(key) >= 0 && list.indexOf(key) < at) void confirmNavigation().then(allowed => { if (allowed) go(key) })
    },
    finish: target => leave('done', target, t('data.setup.done')),
    skip: () => leave('skipped', '/', t('data.setup.skipped')),
  }
}
