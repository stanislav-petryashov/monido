import { FieldError } from './FieldError'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { PasswordInput } from '../../../components/ui/PasswordInput'
import type { NewPasswordProblem } from '../../../domain/password'
import { Field } from './Field'

/**
 * A new family password and its repeat, with the hint and the problem worded under them (errors.password_too_* on the
 * first field, auth.passwordMismatch on the repeat). The captions default to the Sign-in settings' own; `labels` gives
 * another place its words.
 */
export function NewPasswordFields({ password, repeat, onPassword, onRepeat, problem, labels }: {
  password: string; repeat: string; onPassword: (v: string) => void; onRepeat: (v: string) => void; problem: NewPasswordProblem
  labels?: { password: string; repeat: string; hint: string }
}) {
  const { t } = useTranslation()
  const errorId = useId()
  const described = problem ? errorId : undefined
  const words = labels ?? { password: t('users.signIn.password.new'), repeat: t('users.signIn.password.repeat'), hint: t('users.signIn.password.hint') }
  return (
    <>
      <Field label={words.password} hint={words.hint}>
        <PasswordInput value={password} onChange={onPassword} autoComplete="new-password" invalid={problem !== null && problem !== 'mismatch'} aria-describedby={described} />
      </Field>
      <Field label={words.repeat}>
        <PasswordInput value={repeat} onChange={onRepeat} autoComplete="new-password" invalid={problem === 'mismatch'} aria-describedby={described} />
      </Field>
      {problem && <FieldError id={errorId}>{problem === 'mismatch' ? t('auth.passwordMismatch') : t(`errors.${problem}`)}</FieldError>}
    </>
  )
}
