import { useEffect, useRef } from 'react'
import '../../styles/setup.css'
import { Loading } from '../../components/ui/Loading'
import { Stepper } from './Stepper'
import type { StepProps } from './SetupBar'
import { forgetFocused, markFocused, useSetupWizard } from './useSetupWizard'
import { CurrenciesStep } from './steps/CurrenciesStep'
import { DataStep } from './steps/DataStep'
import { MembersStep } from './steps/MembersStep'
import { WelcomeStep } from './steps/WelcomeStep'

function CurrentStep({ wizard }: StepProps) {
  switch (wizard.step) {
    case 'welcome': return <WelcomeStep wizard={wizard} />
    case 'data': return <DataStep wizard={wizard} />
    case 'members': return <MembersStep wizard={wizard} />
    case 'currencies': return <CurrenciesStep wizard={wizard} />
  }
}

/**
 * The setup wizard (standalone on the first run, under the page header on /setup): the stepper and the current step. On
 * every step change the step's h2 takes the focus and the card scrolls to its top; the first mount focuses the h2 without
 * scrolling, on a re-run not at all (the shell focuses the page title); a remount on the same step does neither. A re-run
 * forgets its step when it unmounts: a first run after it (a wipe) focuses its Welcome heading again.
 */
export function SetupWizard({ again }: { again: boolean }) {
  const wizard = useSetupWizard({ again })
  const bodyRef = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  const ready = wizard.steps.length > 0

  useEffect(() => {
    if (!ready) return
    const mount = first.current
    first.current = false
    // a remount on the same step (a language pick remounts the app) leaves the focus and the scroll where they are
    if (!markFocused(wizard.step)) return
    if (mount && again) return
    const body = bodyRef.current
    body?.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true })
    // the first mount keeps the page at its top: on a phone the standalone header stays in view
    if (mount) return
    const card = body?.closest('.setup-card') ?? body
    card?.scrollIntoView?.({ block: 'start' })
  }, [ready, wizard.step, again])
  // a re-run never focuses on mount, so its remount (a language pick) needs no memory; a first run that follows does
  useEffect(() => () => { if (again) forgetFocused() }, [again])

  return (
    <div ref={bodyRef} className="setup-wizard">
      <Stepper wizard={wizard} />
      <div className="setup-wizard__body form-stack">{ready ? <CurrentStep wizard={wizard} /> : <Loading />}</div>
    </div>
  )
}
