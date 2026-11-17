import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { AmountInput } from '../admin/ui/AmountInput'
import { Field } from '../admin/ui/Field'
import { parseAmount } from '../admin/amount'

interface WhatIfSavingProps {
  /** What the family saves a month (the 3-month average): where "back to it" goes */
  actual: number
  /** The amount typed, as text; '' — none: the plan is the actual one */
  value: string
  onChange: (text: string) => void
  fmt: (v: number) => string
}

/**
 * "What if we saved X a month": a field under the saving that re-runs the whole goals plan on the page (nothing is saved),
 * and "Back to <actual>" while it holds an amount. A goal on time does not get earlier with more: it already gets what it
 * needs by its deadline, said in the hint.
 */
export function WhatIfSaving({ actual, value, onChange, fmt }: WhatIfSavingProps) {
  const { t } = useTranslation()
  const hintId = useId()
  const active = parseAmount(value).value !== null
  return (
    <div className="gl-whatif">
      <Field label={t('goalsPage.whatIf.label')}>
        <AmountInput label={t('goalsPage.whatIf.label')} value={value} onChange={onChange} placeholder={fmt(actual)} aria-describedby={hintId} />
      </Field>
      <p id={hintId} className="gl-whatif__hint">{t(active ? 'goalsPage.whatIf.active' : 'goalsPage.whatIf.hint')}</p>
      {active && <button type="button" className="link-button" onClick={() => onChange('')}>{t('goalsPage.whatIf.reset', { amount: fmt(actual) })}</button>}
    </div>
  )
}
