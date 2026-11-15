import { useTranslation } from 'react-i18next'
import { IconPlusMinus } from '@tabler/icons-react'

/**
 * The ± button of a signed number field on a touchscreen, whose decimal keypad has no minus: flips the sign of the
 * canonical `value` and hands the result to `onToggle` (useMaskedInput's setValue, which keeps the caret). It goes in
 * the field's `.input-unit__end`, the field wrapped in `.input-unit.input-unit--signed`.
 */
export function SignButton({ value, onToggle }: { value: string; onToggle: (canonical: string) => void }) {
  const { t } = useTranslation()
  return (
    // mousedown would take the focus from the field and close a phone's keyboard
    <button type="button" className="input-btn" aria-label={t('data.common.toggleSign')}
      onMouseDown={e => e.preventDefault()} onClick={() => onToggle(value.startsWith('-') ? value.slice(1) : `-${value}`)}>
      <IconPlusMinus size={16} stroke={2} aria-hidden="true" />
    </button>
  )
}
