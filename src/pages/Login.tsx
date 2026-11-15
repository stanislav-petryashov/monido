import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Card } from '../components/ui/Card'
import { PasswordInput } from '../components/ui/PasswordInput'
import { Field } from './admin/ui/Field'
import { TelegramSignIn } from './TelegramSignIn'
import { LanguageMenu } from '../components/layout/LanguageMenu'
import { t as translate } from '../i18n/client'
import { passwordProblem } from '../domain/password'
import { bootstrapPassword, login, reloadAuth, useAuth } from '../lib/authState'
import '../styles/admin.css'

/**
 * The demo's sign-in: why the visitor is back here (the server was restarted) and the password.
 */
function DemoIntro({ password, restarted }: { password: string; restarted: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="login__demo">
      {restarted && <p role="status" className="login__notice">{t('demo.login.restarted')}</p>}
      <p>{t('demo.login.subtitle')}</p>
      <p><Trans i18nKey="demo.login.hint" values={{ password }} components={{ code: <code className="login__password" /> }} /></p>
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
  const errorId = useId()
  // index.html carries the English title; the signed-in shell sets its own (AppShell)
  useEffect(() => { document.title = t('app.title') }, [t])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password || busy) return
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
    <LoginShell tools={demo && <div className="login__tools"><LanguageMenu /></div>}>
      <form className="form-stack" onSubmit={submit}>
        <h1 className="login__title">{t('app.title')}</h1>
        {demo
          ? <DemoIntro password={demo.hint} restarted={demo.restarted} />
          : <p className="login__subtitle">{t('auth.subtitle')}</p>}
        {/* the demo shows its password above; a family is told whom to ask */}
        <Field label={t('auth.password')} hint={demo ? undefined : t('auth.forgot')}>
          <PasswordInput autoFocus value={password} onChange={setPassword} aria-describedby={error ? errorId : undefined} invalid={error !== null} />
        </Field>
        {error && <p id={errorId} role="alert" className="login__error">{error()}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{t('auth.signIn')}</button>
        </div>
      </form>
    </LoginShell>
  )
}
