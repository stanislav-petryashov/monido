import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SetupWizard as Wizard } from './useSetupWizard'

export interface StepProps { wizard: Wizard }

/**
 * The action bar every step renders at its form's end: Back and the step's own left-hand buttons, then the reason a
 * disabled primary is off (visible, tied to it by aria-describedby) and the primary, the form's submit. `busy` keeps the
 * primary focusable while its write runs (aria-disabled); the step's submit ignores a press meanwhile.
 */
export function SetupBar({ onBack, left, primary, disabled, why, describedBy, busy }: { onBack?: () => void; left?: ReactNode; primary: string; disabled?: boolean; why?: string; describedBy?: string; busy?: boolean }) {
  const { t } = useTranslation()
  const whyId = useId()
  return (
    <div className="setup-bar">
      {why && <span id={whyId} className="setup-bar__why">{why}</span>}
      <div className="setup-bar__left">
        {onBack && <button type="button" className="btn btn--ghost" onClick={onBack}>{t('data.setup.back')}</button>}
        {left}
      </div>
      <div className="setup-bar__right">
        <button type="submit" className="btn btn--primary" disabled={disabled} aria-disabled={busy || undefined} aria-describedby={why ? whyId : describedBy}>{primary}</button>
      </div>
    </div>
  )
}
