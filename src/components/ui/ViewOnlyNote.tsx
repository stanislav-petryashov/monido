import { useTranslation } from 'react-i18next'
import type { Right } from '../../domain/api'
import { useCan } from '../../lib/rights'

/** Says why a screen offers no changes: shown once per page, only to someone without the right. */
export function ViewOnlyNote({ right }: { right: Extract<Right, 'edit' | 'manage'> }) {
  const { t } = useTranslation()
  if (useCan(right)) return null
  return <p className="note" role="note">{t(`common.viewOnly.${right}`)}</p>
}
