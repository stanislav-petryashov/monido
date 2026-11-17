import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Card } from '../components/ui/Card'
import { PasswordInput } from '../components/ui/PasswordInput'
import { Field } from './admin/ui/Field'
import { TelegramSignIn } from './TelegramSignIn'
import { LanguageMenu } from '../components/layout/LanguageMenu'
import { SegmentedPills } from '../components/ui/SegmentedPills'
import { applyFamilyLanguage } from '../i18n/client'
import { LANGUAGES, languageName, type Language } from '../i18n/languages'
import { t as translate } from '../i18n/client'
import { passwordProblem } from '../domain/password'
import { bootstrapPassword, login, reloadAuth, useAuth } from '../lib/authState'
import '../styles/admin.css'

/**
 * The demo's sign-in: why the visitor is back here (the server was restarted), the password, and the language, which
 * picks the family too: each language has its own, in its country's currency (the sandbox copies that language's template).
 */
function DemoIntro({ password, restarted, locked, onSwitching }: { password: string; restarted: boolean; locked: boolean; onSwitching: (on: boolean) => void }) {
  const { t, i18n } = useTranslation()
  // one switch at a time, and none while signing in: a later pick cannot be overtaken by an earlier one still loading,
  // and the sign-in sends the language the family comes from only once it is in place
  const choose = (lang: Language) => {
    if (locked || lang === i18n.language) return
    onSwitching(true)
    // the language stays as it was when the switch fails; the pills keep working
    applyFamilyLanguage(lang)
      .catch((e: unknown) => { console.error('[language] switch failed', e) })
      .finally(() => onSwitching(false))
  }
  return (
    <div className="login__demo">
      {restarted && <p role="status" className="login__notice">{t('demo.login.restarted')}</p>}
      <p>{t('demo.login.subtitle')}</p>
      <p><Trans i18nKey="demo.login.hint" values={{ password }} components={{ code: <code className="login__password" /> }} /></p>
      <div className="login__languages">
        <p className="login__languages-label">{t('demo.login.language')}</p>
        <SegmentedPills items={LANGUAGES} active={i18n.language as Language} onSelect={choose} ariaLabel={t('demo.login.language')} label={languageName}
          disabledReason={() => (locked ? t('common.loading') : undefined)} />
        <p className="login__family">{t('demo.login.family')}</p>
      </div>
    </div>
  )
}

/** The sign-in screens' frame: one centred card; `tools` sit above it */
function LoginShell({ tools, children }: { tools?: ReactNode; children: ReactNode }) {
  return (
    <main className="login">
      {tools ?? <div className="login__tools"><LanguageMenu /></div>}
      <Card className="login__card">{children}</Card>
    </main>
  )
}

/** A new installation: the family password is set here, typed twice, while the server's window is open; after the window the card tells how to open it again. */
function BootstrapCard({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<(() => string) | null>(null)
  const [busy, setBusy] = useState(false)
  const [closed, setClosed] = useState(false)
  const errorId = useId()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const problem = passwordProblem(password)
    if (problem) { setError(() => () => translate(`errors.${problem}`)); return }
    if (password !== repeat) { setError(() => () => translate('auth.passwordMismatch')); return }
    setBusy(true)
    setError(null)
    try {
      const result = await bootstrapPassword(password)
      if (result.ok) await reloadAuth()
      else if (result.code === 'bootstrap_closed') setClosed(true)
      else setError(() => result.error)
    } finally {
      setBusy(false)
    }
  }

  if (!open || closed) {
    return (
      <LoginShell>
        <div className="form-stack">
          <h1 className="login__title">{t('auth.bootstrap.closedTitle')}</h1>
          <p className="login__subtitle"><Trans i18nKey="auth.bootstrap.closedText" components={{ code: <code /> }} /></p>
          <div className="form-actions">
            <button type="button" className="btn btn--ghost" onClick={() => { setClosed(false); void reloadAuth() }}>{t('auth.bootstrap.retry')}</button>
          </div>
        </div>
      </LoginShell>
    )
  }
  return (
    <LoginShell>
      <form className="form-stack" onSubmit={submit}>
        <h1 className="login__title">{t('auth.bootstrap.title')}</h1>
        <p className="login__subtitle">{t('auth.bootstrap.subtitle')}</p>
        <Field label={t('auth.bootstrap.password')} hint={t('auth.bootstrap.passwordHint')}>
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" autoFocus aria-describedby={error ? errorId : undefined} invalid={error !== null} />
        </Field>
        <Field label={t('auth.bootstrap.repeat')}>
          <PasswordInput value={repeat} onChange={setRepeat} autoComplete="new-password" aria-describedby={error ? errorId : undefined} invalid={error !== null} />
        </Field>
        <p className="note">{t('auth.bootstrap.saveHint')}</p>
        {error && <p id={errorId} role="alert" className="login__error">{error()}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{t('auth.bootstrap.submit')}</button>
        </div>
      </form>
    </LoginShell>
  )
}

/** The sign-in screen (the password form, or the Telegram button in telegram mode): one centred card with a line on what to do; after signing in the same page opens. In the demo it introduces the demo. */
export function Login() {
  const { t } = useTranslation() // above the language-keyed remount: re-renders on a switch through the hook
  const { demo, mode, bootstrapOpen } = useAuth()
  const [password, setPassword] = useState('')
  // the error is a function, called at render: the text follows a language switch (the hook's t is bound to one language)
  const [error, setError] = useState<(() => string) | null>(null)
  const [busy, setBusy] = useState(false)
  // the demo's language is loading: the sign-in waits for it
  const [switching, setSwitching] = useState(false)
  const errorId = useId()
  // index.html carries the English title; the signed-in shell sets its own (AppShell)
  useEffect(() => { document.title = t('app.title') }, [t])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password || busy || switching) return
    setBusy(true)
    setError(null)
    try {
      const result = await login(password)
      if (!result.ok) setError(() => result.error)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'bootstrap') return <BootstrapCard open={bootstrapOpen} />

  if (mode === 'telegram') {
    return (
      <LoginShell>
        <div className="form-stack">
          <h1 className="login__title">{t('app.title')}</h1>
          <p className="login__subtitle">{t('auth.telegram.subtitle')}</p>
          <TelegramSignIn />
        </div>
      </LoginShell>
    )
  }

  return (
    // the demo chooses its language in the card, with the family it brings
    <LoginShell tools={demo && <div className="login__tools" />}>
      <form className="form-stack" onSubmit={submit}>
        <h1 className="login__title">{t('app.title')}</h1>
        {demo
          ? <DemoIntro password={demo.hint} restarted={demo.restarted} locked={busy || switching} onSwitching={setSwitching} />
          : <p className="login__subtitle">{t('auth.subtitle')}</p>}
        {/* the demo shows its password above; a family is told whom to ask */}
        <Field label={t('auth.password')} hint={demo ? undefined : t('auth.forgot')}>
          <PasswordInput autoFocus value={password} onChange={setPassword} aria-describedby={error ? errorId : undefined} invalid={error !== null} />
        </Field>
        {error && <p id={errorId} role="alert" className="login__error">{error()}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || switching}>{t('auth.signIn')}</button>
        </div>
      </form>
    </LoginShell>
  )
}
