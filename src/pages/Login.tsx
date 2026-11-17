import { useEffect, useId, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Card } from '../components/ui/Card'
import { PasswordInput } from '../components/ui/PasswordInput'
import { Field } from './admin/ui/Field'
import { TelegramSignIn } from './TelegramSignIn'
import { LanguageMenu } from '../components/layout/LanguageMenu'
import { IconInfoCircle } from '@tabler/icons-react'
import { LogoMark } from '../components/layout/LogoMark'
import type { DemoFamilyCard } from '../demo/family'
import { fmtNum } from '../lib/formatters'
import { applyFamilyLanguage } from '../i18n/client'
import { LANGUAGES, languageName, type Language } from '../i18n/languages'
import { t as translate } from '../i18n/client'
import { passwordProblem } from '../domain/password'
import { bootstrapPassword, login, reloadAuth, useAuth } from '../lib/authState'
import '../styles/admin.css'

/** How many launches the demo counts before it shows them: until then a small number reads worse than none */
const LAUNCHES_SHOWN_FROM = 100

/** A currency's symbol as its family's language writes it ($, €, ₽, R$, ¥) */
const currencySymbol = (code: string, language: Language) =>
  new Intl.NumberFormat(language, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency')?.value ?? code

/** "Ryan and Annika, USA" in the family's own language (Chinese joins with a full-width comma) */
function familyLine(f: DemoFamilyCard): string {
  const names = new Intl.ListFormat(f.language, { type: 'conjunction' }).format(f.members)
  return `${names}${f.language === 'zh-CN' ? '\uFF0C' : ', '}${f.place}`
}

/**
 * The left of the demo's sign-in: what Monido is, three facts about the demo and, on a wide screen, the README image of
 * the chosen language (a background, so a phone never downloads it). The third fact is the count of launches once it is
 * worth showing.
 */
function DemoPitch({ launches }: { launches: number }) {
  const { t, i18n } = useTranslation()
  const facts: [string, string][] = [
    [fmtNum(LANGUAGES.length, 0), t('demo.login.factFamilies')],
    [fmtNum(15, 0), t('demo.login.factMinutes')],
    launches >= LAUNCHES_SHOWN_FROM ? [fmtNum(launches, 0), t('demo.login.factLaunches', { count: launches })] : [fmtNum(0, 0), t('demo.login.factInstall')],
  ]
  return (
    <section className="login__pitch" aria-labelledby="demo-headline">
      <p className="login__brand"><LogoMark size={36} />{t('app.title')}</p>
      <h1 id="demo-headline" className="login__headline">{t('demo.login.headline')}</h1>
      <ul className="login__facts">
        {facts.map(([value, label]) => <li key={label}><span className="login__fact-value num">{value}</span><span>{label}</span></li>)}
      </ul>
      <div className="login__hero" aria-hidden="true" style={{ '--hero': `url(/demo/hero-${i18n.language}.webp)` } as CSSProperties} />
    </section>
  )
}

/**
 * The demo's card: why the visitor is back here (the server was restarted), the families to choose from (the choice is
 * the language too: each language has its own family in its country's currency, and the sandbox copies its template),
 * and the password, filled in, with a note that says so.
 */
function DemoIntro({ demo, locked, onSwitching }: { demo: { hint: string; restarted: boolean; families: DemoFamilyCard[] }; locked: boolean; onSwitching: (on: boolean) => void }) {
  const { t, i18n } = useTranslation()
  // one switch at a time, and none while signing in: a later pick cannot be overtaken by an earlier one still loading,
  // and the sign-in sends the language the family comes from only once it is in place
  const choose = (lang: Language) => {
    if (locked || lang === i18n.language) return
    onSwitching(true)
    // the language stays as it was when the switch fails; the rows keep working
    applyFamilyLanguage(lang)
      .catch((e: unknown) => { console.error('[language] switch failed', e) })
      .finally(() => onSwitching(false))
  }
  return (
    <div className="login__demo">
      {demo.restarted && <p role="status" className="login__notice">{t('demo.login.restarted')}</p>}
      <p>{t('demo.login.pick')}</p>
      {/* aria-disabled, not disabled: a disabled group would drop the keyboard focus of its checked row mid-switch */}
      <fieldset className="login__families" aria-disabled={locked || undefined}>
        <legend className="sr-only">{t('demo.login.families')}</legend>
        {demo.families.map(f => (
          <label key={f.language} className={f.language === i18n.language ? 'login__family is-on' : 'login__family'}>
            <input type="radio" name="demo-family" className="sr-only" checked={f.language === i18n.language} aria-disabled={locked || undefined} onChange={() => { choose(f.language) }} />
            <span className="login__family-dot" aria-hidden="true" />
            <span lang={f.language} className="login__family-lang">{languageName(f.language)}</span>
            <span lang={f.language} className="login__family-who">{familyLine(f)}</span>
            <span className="login__family-cur" aria-hidden="true">{f.currencies.map(c => currencySymbol(c, f.language)).join(' ')}</span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}

/** The sign-in screens' frame: one centred card; `tools` sit above it */
function LoginShell({ tools, aside, children }: { tools?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <main className={aside ? 'login login--demo' : 'login'}>
      {tools ?? <div className="login__tools"><LanguageMenu /></div>}
      {aside}
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
  // the demo's password is public: it is filled in (the auth answer is in before this screen shows), and the card says so
  const [password, setPassword] = useState(() => demo?.hint ?? '')
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
    <LoginShell tools={demo && <div className="login__tools" />} aside={demo && <DemoPitch launches={demo.launches} />}>
      <form className="form-stack" onSubmit={submit}>
        {demo ? <h2 className="login__title">{t('demo.login.title')}</h2> : <h1 className="login__title">{t('app.title')}</h1>}
        {demo
          ? <DemoIntro demo={demo} locked={busy || switching} onSwitching={setSwitching} />
          : <p className="login__subtitle">{t('auth.subtitle')}</p>}
        {/* the demo's password is filled in and named under the field; a family is told whom to ask */}
        <Field label={t('auth.password')} hint={demo ? undefined : t('auth.forgot')}>
          <PasswordInput autoFocus={!demo} value={password} onChange={setPassword} aria-describedby={error ? errorId : undefined} invalid={error !== null} />
        </Field>
        {demo && (
          <p className="login__note">
            <IconInfoCircle size={18} stroke={1.75} aria-hidden="true" />
            <span><Trans i18nKey="demo.login.passwordNote" values={{ password: demo.hint }} components={{ code: <code className="login__password" /> }} /></span>
          </p>
        )}
        {error && <p id={errorId} role="alert" className="login__error">{error()}</p>}
        <div className="form-actions">
          <button type="submit" className={demo ? 'btn btn--primary login__submit' : 'btn btn--primary'} disabled={busy || switching}>{t('auth.signIn')}</button>
        </div>
      </form>
    </LoginShell>
  )
}
