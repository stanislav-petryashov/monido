import { FieldError } from '../admin/ui/FieldError'
import { useTranslation } from 'react-i18next'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { Field } from '../admin/ui/Field'
import type { useCurrentPassword } from './useCurrentPassword'

/** The current password field and, under it, the server's "wrong password" sentence (see useCurrentPassword) */
export function CurrentPasswordField({ label, password }: { label: string; password: ReturnType<typeof useCurrentPassword> }) {
  const { t } = useTranslation()
  const { current, setCurrent, wrong, errorId } = password
  return (
    <>
      <Field label={label}>
        <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" invalid={wrong} aria-describedby={wrong ? errorId : undefined} />
      </Field>
      {wrong && <FieldError id={errorId}>{t('errors.wrong_current_password')}</FieldError>}
    </>
  )
}
