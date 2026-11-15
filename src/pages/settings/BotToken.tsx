import { useTranslation } from 'react-i18next'
import { Field } from '../admin/ui/Field'

/** The token field: a password input, never prefilled, nothing for the browser to remember */
export function TokenField({ value, onChange, inset = false }: { value: string; onChange: (v: string) => void; inset?: boolean }) {
  const { t } = useTranslation()
  return (
    <Field variant={inset ? 'inset' : 'standard'} label={t('users.signIn.bot.token')} hint={t('users.signIn.bot.tokenHint')}>
      <input type="password" className="admin-input" autoComplete="off" spellCheck={false} value={value} onChange={e => onChange(e.target.value)} />
    </Field>
  )
}
