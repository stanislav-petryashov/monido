import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { usePrivacy } from '../../lib/privacy'

/** The eye in the title row: hide or show the dashboard's amounts. */
export function PrivacyToggle() {
  const { t } = useTranslation()
  const { hidden, toggle } = usePrivacy()
  const label = t(hidden ? 'common.showAmounts' : 'common.hideAmounts')
  const Icon = hidden ? IconEyeOff : IconEye
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={hidden} onClick={toggle}>
      <Icon size={22} stroke={1.75} aria-hidden="true" />
    </button>
  )
}
