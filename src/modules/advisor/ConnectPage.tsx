import { PageError } from '../../components/PageError'
import { Loading } from '../../components/ui/Loading'
import { IconPlugConnected } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import '../../styles/admin.css'
import './advisor.css'
import { Link } from '../../components/ui/Link'
import { errorMessage } from '../../i18n/client'
import { ApiError } from '../../lib/api'
import { useToast } from '../../lib/notifyState'
import { answerConsent, browser, useConsentRequest } from './useConnector'

const SHOWN_NAME_MAX = 80
// the client names itself: control and format characters (bidi overrides, zero-width) would let it pose as something else
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu

/** The client's own claim, as plain text: invisible characters out, cut at a length that fits a phone. */
function shownName(name: string | null): string | null {
  const clean = (name ?? '').replace(INVISIBLE, '').trim().slice(0, SHOWN_NAME_MAX)
  return clean || null
}

/** Only a web or loopback address is a place to send the browser back to. */
function isWebAddress(address: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(address).protocol) } catch { return false }
}

/** A plain error and the way back to the Advisor page. */
function ConnectError({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="form-card consent">
      <div className="consent__symbol" aria-hidden="true"><IconPlugConnected size={36} stroke={1.4} /></div>
      <PageError className="consent__error">{message}</PageError>
      <Link to="/advisor/ask" className="btn btn--ghost">{t('modules.advisor.consent.back')}</Link>
    </div>
  )
}

/** What the screen asks: a pending request of this browser, answered once. */
function Consent({ id }: { id: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const request = useConsentRequest(id)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (request.isPending) return <Loading className="reminder-state" />
  if (request.isError) return <ConnectError message={request.error.message} />
  if (failure) return <ConnectError message={failure} />
  const { clientName, redirectHost, member } = request.data

  async function answer(approve: boolean) {
    // aria-disabled, not disabled: the pressed button keeps the keyboard focus
    if (busy) return
    setBusy(true)
    try {
      const { redirect } = await answerConsent(id, approve)
      if (!isWebAddress(redirect)) return setFailure(t('modules.advisor.consent.failed'))
      // stays busy: the page is going away, a second click must not answer again
      browser.go(redirect)
    } catch (e) {
      // the request is gone or belongs to another browser: nothing left to answer; anything else may be tried again
      if (e instanceof ApiError && e.code?.startsWith('advisor.')) setFailure(e.message)
      else toast.error(t('modules.advisor.consent.failed'), e)
      setBusy(false)
    }
  }

  return (
    <div className="form-card consent">
      <div className="consent__symbol" aria-hidden="true"><IconPlugConnected size={36} stroke={1.4} /></div>
      <h2 className="consent__title">{member === null ? t('modules.advisor.consent.titleFamily') : t('modules.advisor.consent.title', { member })}</h2>
      <dl className="consent__facts">
        <div>
          <dt>{t('modules.advisor.consent.app')}</dt>
          <dd><bdi>{shownName(clientName) ?? t('modules.advisor.consent.unnamed')}</bdi></dd>
        </div>
        <div>
          <dt>{t('modules.advisor.consent.sendsTo')}</dt>
          <dd><bdi>{redirectHost}</bdi></dd>
        </div>
      </dl>
      <p className="consent__text">{t('modules.advisor.consent.check')}</p>
      <p className="consent__text">{member === null ? t('modules.advisor.consent.grantsFamily') : t('modules.advisor.consent.grants', { member })}</p>
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" aria-disabled={busy || undefined} onClick={() => void answer(false)}>{t('modules.advisor.consent.deny')}</button>
        <button type="button" className="btn btn--primary" aria-disabled={busy || undefined} onClick={() => void answer(true)}>{t('modules.advisor.consent.allow')}</button>
      </div>
    </div>
  )
}

/**
 * Where Claude's sign-in lands: `?request=<id>` asks the signed-in member to allow Claude to act as them; `?error=advisor.<code>`
 * (or no request at all) says what went wrong. The client name is the client's own claim, so the redirect host is shown beside it.
 */
export function ConnectPage() {
  const { t } = useTranslation()
  const params = new URLSearchParams(window.location.search)
  const id = params.get('request')
  const error = params.get('error')
  if (id && !error) return <Consent id={id} />
  const incomplete = errorMessage('advisor.invalid_request', undefined, t('common.loadError'))
  const code = error && /^advisor\.[a-z_]+$/.test(error) ? error : null
  return <ConnectError message={code ? errorMessage(code, undefined, incomplete) : incomplete} />
}
