import { PageError } from '../../components/PageError'
import { Loading } from '../../components/ui/Loading'
import { CopyPromptButton } from '../claude-prompts/CopyPromptButton'
import { useSnapshot } from '../../lib/useFinanceData'
import { Disclosure, DisclosureGroup } from '../../components/ui/Disclosure'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import '../../styles/admin.css'
import './advisor.css'
import { useToast } from '../../lib/notifyState'
import { copyText } from '../../lib/clipboard'
import { SettingsSection } from '../../pages/admin/ui/SettingsSection'
import { useGuide } from './useConnector'
import { ClaudeConnection } from './ClaudeConnection'
import { useAuth } from '../../lib/authState'
import { useProposals } from './useProposals'

const EXAMPLES = [1, 2, 3, 4]
const CAN = [1, 2, 3, 4]
const CANNOT = [1, 2, 3]
const RULES = [1, 2, 3, 4]

/** A heading and the list it names. */
function Group({ title, children, ordered = false }: { title: string; children: ReactNode; ordered?: boolean }) {
  const id = useId()
  const List = ordered ? 'ol' : 'ul'
  return (
    <section className="ask-guide-section" aria-labelledby={id}>
      <h3 id={id} className="advisor-subhead">{title}</h3>
      <List aria-labelledby={id} className="advisor-list">{children}</List>
    </section>
  )
}

/** Copies `text` and says whether it worked. */
function useCopy() {
  const { t } = useTranslation()
  const toast = useToast()
  return async (text: string) => {
    if (await copyText(text)) toast.success(t('modules.advisor.copied'))
    else toast.error(t('modules.advisor.copyFailed'))
  }
}

/** The full English guide Claude reads: fetched on the first open, copyable. */
function GuideBlock() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const guide = useGuide(open)
  const copy = useCopy()
  const bodyId = useId()
  return (
    <div className="advisor-guide">
      <div className="form-actions form-actions--start">
        <button type="button" className="btn btn--ghost" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
          {t(open ? 'modules.advisor.use.guideHide' : 'modules.advisor.use.guideShow')}
        </button>
        {open && guide.data !== undefined && (
          <button type="button" className="btn btn--ghost" onClick={() => void copy(guide.data)}>{t('modules.advisor.use.guideCopy')}</button>
        )}
      </div>
      <div id={bodyId}>
        {open && (guide.isError
          ? <PageError className="reminder-state" />
          : guide.data === undefined
            ? <Loading className="reminder-state" />
            : <pre className="advisor-guide__text" lang="en" tabIndex={0}>{guide.data}</pre>)}
      </div>
    </div>
  )
}

/** Example questions, what Claude can and cannot do, its rules, the guide, the disclaimer. */
function UseBlock() {
  const { t } = useTranslation()
  return (
    <>
      <Group title={t('modules.advisor.use.examplesTitle')}>
        {EXAMPLES.map(n => <li key={n}>{t(`modules.advisor.use.examples.${n}`)}</li>)}
      </Group>
      <Group title={t('modules.advisor.use.canTitle')}>
        {CAN.map(n => <li key={n}>{t(`modules.advisor.use.can.${n}`)}</li>)}
      </Group>
      <Group title={t('modules.advisor.use.cannotTitle')}>
        {CANNOT.map(n => <li key={n}>{t(`modules.advisor.use.cannot.${n}`)}</li>)}
      </Group>
      <Group title={t('modules.advisor.use.rulesTitle')}>
        {RULES.map(n => <li key={n}>{t(`modules.advisor.use.rules.${n}`)}</li>)}
      </Group>
      <GuideBlock />
      <p className="reminder-state">{t('modules.advisor.use.disclaimer')}</p>
      <p className="reminder-state">{t('modules.advisor.use.privacy')}</p>
    </>
  )
}

/** The second tab of Advisor: a question to copy, connecting one's own Claude to this server, and how to use it. */
export function AskClaudePage() {
  const { t } = useTranslation()
  const { mode, me } = useAuth()
  const unavailable = useProposals().data?.available === false
  return (
    <div className="ask-page">
      {unavailable && <p className="note mb-2">{t('modules.advisor.proposals.unavailable')}</p>}
      <ManualQuestion />
      <SettingsSection title={t('modules.advisor.connect.title')}>
        <ClaudeConnection key={`${mode}:${me?.name}`} />
      </SettingsSection>
      <DisclosureGroup>
        <Disclosure title={t('modules.advisor.use.title')}>
          <UseBlock />
        </Disclosure>
      </DisclosureGroup>
    </div>
  )
}

/** The manual route uses the same deliberate preview/copy contract as metric cards. */
function ManualQuestion() {
  const { t } = useTranslation()
  const snapshot = useSnapshot()
  return <SettingsSection title={t('modules.advisor.manual.title')}>
    <p>{t('modules.advisor.manual.description')}</p>
    {snapshot.isPending ? <Loading className="advisor-state" /> : snapshot.isError ? <PageError className="advisor-state" />
      : <CopyPromptButton metric="net_worth" label={t('modules.advisor.manual.preview')} />}
  </SettingsSection>
}
