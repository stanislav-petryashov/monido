import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loading } from '../../components/ui/Loading'
import { Chip } from '../../components/ui/Chip'
import { Disclosure, DisclosureGroup } from '../../components/ui/Disclosure'
import { Link } from '../../components/ui/Link'
import { Notice } from '../../components/ui/Notice'
import { ProgressTrack } from '../../components/ui/ProgressTrack'
import { copyText } from '../../lib/clipboard'
import { fmtDayYear } from '../../lib/formatters'
import { useAuth } from '../../lib/authState'
import { useConfirm, useToast } from '../../lib/notifyState'
import { Field } from '../../pages/admin/ui/Field'
import { SetupBar } from '../../pages/setup/SetupBar'
import { useConnector, useDisconnect } from './useConnector'
import '../../styles/setup.css'

const CONNECTORS_URL = 'https://claude.ai/customize/connectors'
const HELP_URL = 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'

export function ClaudeConnection() {
  const { t } = useTranslation()
  const { me, mode } = useAuth()
  // the family password: one connection, the family's; the address stays for another app
  const [stage, setStage] = useState<'add' | 'waiting' | 'paused'>('add')
  const [hadAccess, setHadAccess] = useState(false)
  const connector = useConnector(stage === 'waiting' ? 2000 : false)
  const disconnect = useDisconnect()
  const confirm = useConfirm()
  const toast = useToast()
  const membersId = useId()
  const view = connector.data
  // signed in with the family password: a session with no member name (Telegram sessions carry the member's)
  const family = mode === 'password' && me !== null && me.name === null
  const mine = !connector.isError && view?.available ? view.connected.find(c => c.you) : undefined
  if (mine && !hadAccess) setHadAccess(true)
  if (mine && stage !== 'add' && !family) setStage('add')
  // the family's connection stays open for another app: a new approval (a newer lastIssuedAt) ends the waiting
  const [familySeen, setFamilySeen] = useState<string | null>(null)
  const familyStamp = family && mine ? mine.lastIssuedAt : null
  // only a successful read moves the baseline: a failed one says nothing about the connection
  if (connector.isSuccess && !connector.isError && familyStamp !== familySeen) {
    setFamilySeen(familyStamp)
    if (familyStamp !== null && stage !== 'add') setStage('add')
  }

  const connected = !!mine && !family
  useEffect(() => {
    if (stage !== 'waiting' || connected) return
    const timer = window.setTimeout(() => setStage('paused'), 5 * 60_000)
    return () => window.clearTimeout(timer)
  }, [stage, connected])

  const check = <button type="button" className="btn btn--ghost" disabled={connector.isFetching} onClick={() => void connector.refetch()}>{t('modules.advisor.connect.check')}</button>

  if (connector.isPending) return <Loading className="reminder-state" />
  if (connector.isError) return <div className="form-stack">
    <div role="alert"><Notice tone="warning" title={t('modules.advisor.connect.checkFailed')}>{t('modules.advisor.connect.checkFailedHint')}</Notice></div>
    <div className="form-actions form-actions--start">{check}</div>
  </div>
  if (!view?.available || !view.mcpUrl) return <div className="form-stack">
    <p className="alert alert--warning" role="status">{t(`modules.advisor.connect.unavailable.${view?.reason ?? 'auth_mode'}`)}</p>
    <p className="note">{t(view?.reason === 'app_url' ? 'modules.advisor.connect.serverSetup' : 'modules.advisor.connect.authSetup')}</p>
    {view?.reason !== 'app_url' && <Link to="/settings/family" className="link-accent">{t('routes.familyAccess')}</Link>}
    <p className="field__hint">{t('modules.advisor.connect.autoReady')}</p>
    <div className="form-actions form-actions--start">{check}</div>
  </div>

  async function copy() {
    if (await copyText(view!.mcpUrl!)) toast.success(t('modules.advisor.copied'))
    else toast.error(t('modules.advisor.copyFailed'))
  }
  async function askDisconnect() {
    if (await confirm({ title: t('modules.advisor.connect.disconnectTitle'), text: t(family ? 'modules.advisor.connect.disconnectFamilyText' : 'modules.advisor.connect.disconnectText'), confirmLabel: t('modules.advisor.connect.disconnectConfirm'), tone: 'danger' })) disconnect.mutate()
  }

  const familySummary = family && mine ? <>
    <h3 className="setup-card__title">{t('modules.advisor.connect.successFamily')}</h3>
    <p role="status"><Chip color="success">{t('modules.advisor.connect.grantedFamily', { count: mine.clients, date: fmtDayYear(mine.lastIssuedAt.slice(0, 10)) })}</Chip></p>
    <p className="note">{t('modules.advisor.connect.successFamilyHint')}</p>
    <div className="form-actions form-actions--start"><a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="btn btn--primary">{t('modules.advisor.connect.openClaude')}</a></div>
    <h3 className="setup-card__title">{t('modules.advisor.connect.anotherApp')}</h3>
  </> : null

  return <div className="form-stack">
    {familySummary}
    {mine && !family ? <>
      <h3 className="setup-card__title">{t('modules.advisor.connect.success')}</h3>
      <p role="status"><Chip color="success">{t('modules.advisor.connect.granted', { member: mine.member })}</Chip></p>
      <p className="note">{t('modules.advisor.connect.successHint')}</p>
      <div className="form-actions form-actions--start"><a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="btn btn--primary">{t('modules.advisor.connect.openClaude')}</a></div>
      <p className="field__hint">{t('modules.advisor.connect.grantOnly')}</p>
    </> : <>
      {hadAccess && !mine && <Notice tone="warning" title={t('modules.advisor.connect.revoked')}>{t('modules.advisor.connect.revokedHint')}</Notice>}
      <p className="progress-label" aria-live="polite">{t(stage === 'add' ? 'modules.advisor.connect.stageAdd' : 'modules.advisor.connect.stageConfirm')}</p>
      <ProgressTrack pct={stage === 'add' ? 0 : 50} label={t('modules.advisor.connect.stepsLabel')} valueText={t(stage === 'add' ? 'modules.advisor.connect.add' : stage === 'paused' ? 'modules.advisor.connect.unconfirmed' : 'modules.advisor.connect.waiting')} />
      <h3 className="setup-card__title">{t(stage === 'add' ? 'modules.advisor.connect.add' : 'modules.advisor.connect.confirm')}</h3>
      {stage === 'add' ? <>
        <p className="note">{t('modules.advisor.connect.addHint')}</p>
        <Field variant="inset" label={t('modules.advisor.connect.address')}><input className="admin-input" readOnly value={view.mcpUrl} onFocus={e => e.target.select()} /></Field>
        <form onSubmit={e => {
          e.preventDefault()
          window.open(CONNECTORS_URL, '_blank', 'noopener,noreferrer')
          setStage('waiting')
          void connector.refetch()
        }}><SetupBar primary={t('modules.advisor.connect.openConnectors')} left={<button type="button" className="btn btn--ghost" onClick={() => void copy()}>{t('modules.advisor.connect.copyAddress')}</button>} /></form>
      </> : <>
        <p className="note">{t(family ? 'modules.advisor.connect.confirmFamilyHint' : me?.name ? 'modules.advisor.connect.confirmMemberHint' : 'modules.advisor.connect.confirmHint', { member: me?.name })}</p>
        <p role="status">{t(stage === 'paused' ? 'modules.advisor.connect.unconfirmed' : 'modules.advisor.connect.waiting')}</p>
        {stage === 'paused' && <Notice tone="subtle">{t('modules.advisor.connect.waitHint')}</Notice>}
        <div className="form-actions form-actions--start">{check}<button type="button" className="btn btn--ghost" onClick={() => setStage('add')}>{t('modules.advisor.connect.stop')}</button></div>
        <a href={CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className="link-accent">{t('modules.advisor.connect.openConnectors')}</a>
      </>}
    </>}
    <DisclosureGroup>
      <Disclosure title={t(mine ? 'modules.advisor.connect.access' : 'modules.advisor.connect.help')} titleAs="h3">
        <div className="form-stack">
          <div>
            <h4 id={membersId} className="advisor-subhead">{t('modules.advisor.connect.connected')}</h4>
            {view.connected.length ? <ul aria-labelledby={membersId} className="advisor-members">
              {view.connected.map(c => <li key={c.member ?? 'family'}>{c.member ?? t('modules.advisor.connect.family')}{c.you && c.member !== null && <span className="advisor-you">{t('modules.advisor.connect.you')}</span>}</li>)}
            </ul> : <p className="note">{t('modules.advisor.connect.nobody')}</p>}
            {!mine && !family && view.connected.length > 0 && <p className="note">{t('modules.advisor.connect.otherMember')}</p>}
          </div>
          {mine ? <>
            {family && <p className="note">{t('modules.advisor.connect.disconnectFamilyText')}</p>}
            <div className="form-actions form-actions--start"><button type="button" className="btn btn--danger" disabled={disconnect.isPending} onClick={() => void askDisconnect()}>{t(family ? 'modules.advisor.connect.disconnectFamily' : 'modules.advisor.connect.disconnect')}</button></div>
          </> : <>
            <p className="note">{t('modules.advisor.connect.oauthHelp')}</p>
            <p className="note">{t('modules.advisor.connect.teamHelp')}</p>
            <p className="note">{t('modules.advisor.connect.waitHint')}</p>
            <p className="note">{t('modules.advisor.connect.stopHint')}</p>
          </>}
          <p className="note">{t('modules.advisor.connect.lost')}</p>
          <a href={CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className="link-accent">{t('modules.advisor.connect.openConnectors')}</a>
          <a href={HELP_URL} target="_blank" rel="noopener noreferrer" className="link-accent">{t('modules.advisor.connect.helpLink')}</a>
        </div>
      </Disclosure>
    </DisclosureGroup>
  </div>
}
