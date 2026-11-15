import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cancelTelegramLogin, pollTelegramLogin, pollTelegramProof, startTelegramLogin } from '../lib/authState'

const POLL_MS = 2000
const MAX_FAILED_LOOKS = 3

type Phase = { name: 'idle' | 'expired' | 'mismatch' } | { name: 'waiting' | 'failed'; link: string }

interface TelegramProof {
  userId?: number
  onDone: (r: { member: string; manage: boolean }) => void
  actions?: (state: { primary: string; disabled: boolean; busy: boolean }) => ReactNode
}

/** The same confirmation opens a session at sign-in, or proves the selected profile in Settings. */
export function TelegramSignIn({ proof }: { proof?: TelegramProof } = {}) {
  const { t } = useTranslation()
  const proving = !!proof
  const proofRef = useRef(proof)
  useEffect(() => { proofRef.current = proof })
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<(() => string) | null>(null)
  const pending = useRef<string | null>(null)
  const lifetime = useRef(0)
  const starting = useRef(false)
  const inFlight = useRef(false)
  const link = phase.name === 'waiting' ? phase.link : null

  useEffect(() => {
    const generation = ++lifetime.current
    return () => {
      lifetime.current = generation + 1
      if (pending.current) void cancelTelegramLogin(pending.current).catch(() => {})
      pending.current = null
    }
  }, [])

  useEffect(() => {
    if (!link) return
    let stopped = false
    let failed = 0
    async function look() {
      if (stopped || inFlight.current) return
      inFlight.current = true
      try {
        const result = proving ? await pollTelegramProof() : { status: await pollTelegramLogin() }
        failed = 0
        if (stopped || result.status === 'waiting') return
        stopped = true
        clearInterval(timer)
        pending.current = null
        if (result.status === 'expired' || result.status === 'mismatch') setPhase({ name: result.status })
        if (result.status === 'done' && 'manage' in result) {
          setPhase({ name: 'idle' })
          proofRef.current?.onDone({ member: result.member, manage: result.manage })
        }
      } catch {
        if (stopped || ++failed < MAX_FAILED_LOOKS) return
        stopped = true
        clearInterval(timer)
        setPhase({ name: 'failed', link: link! })
      } finally { inFlight.current = false }
    }
    const timer = setInterval(() => void look(), POLL_MS)
    const returned = () => { if (document.visibilityState !== 'hidden') void look() }
    window.addEventListener('focus', returned)
    document.addEventListener('visibilitychange', returned)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', returned)
      document.removeEventListener('visibilitychange', returned)
    }
  }, [link, proving])

  async function start() {
    if (starting.current || phase.name === 'waiting') return
    if (phase.name === 'failed') { setPhase({ name: 'waiting', link: phase.link }); return }
    starting.current = true
    setBusy(true)
    setError(null)
    const generation = lifetime.current
    const result = await startTelegramLogin(proofRef.current?.userId)
    starting.current = false
    if (generation !== lifetime.current) {
      if (result.ok && result.attempt) void cancelTelegramLogin(result.attempt).catch(() => {})
      return
    }
    setBusy(false)
    if (!result.ok) { setError(() => result.error); return }
    pending.current = result.attempt ?? null
    setPhase({ name: 'waiting', link: result.link })
    window.open(result.link, '_blank', 'noopener')
  }

  const label = phase.name === 'failed' ? t('users.signIn.switch.checkStatus')
    : phase.name === 'expired' || phase.name === 'mismatch' ? t('auth.telegram.again')
    : t(proving ? 'users.signIn.switch.prove' : 'auth.telegram.button')
  return (
    <form className="form-stack" onSubmit={e => { e.preventDefault(); void start() }}>
      {phase.name === 'expired' && <p role="status" className={proving ? 'users-note' : 'login__notice'}>{t('auth.telegram.expired')}</p>}
      {phase.name === 'mismatch' && <p role="alert" className="users-note users-note--error">{t('users.signIn.switch.mismatch')}</p>}
      {phase.name === 'waiting' && (
        <p role="status" className={proving ? 'users-note' : 'login__subtitle'}>
          {t('auth.telegram.waiting')} <a href={phase.link} target="_blank" rel="noopener noreferrer" className="link-accent">{t('auth.telegram.openLink')}</a>
        </p>
      )}
      {phase.name === 'failed' && <p role="alert" className={proving ? 'users-note users-note--error' : 'login__error'}>{t('auth.telegram.failed')}</p>}
      {error && <p role="alert" className={proving ? 'users-note users-note--error' : 'login__error'}>{error()}</p>}
      {proof?.actions ? proof.actions({ primary: label, disabled: phase.name === 'waiting', busy }) : (
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || phase.name === 'waiting'}>{label}</button>
        </div>
      )}
    </form>
  )
}
