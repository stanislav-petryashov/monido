import { PageError } from '../../components/PageError'
import { Loading } from '../../components/ui/Loading'
// The Advisor page's proposals: the open and revising ones as cards, then the history of the decided ones, each
// expandable to its card, an accepted goal decision with its goal. A link to /advisor#proposal-<id> (the Telegram card's
// "Details on the site", the bot's late reply) opens that proposal and focuses its card once the data has loaded.
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DisclosureChevron } from '../../components/ui/DisclosureChevron'
import { Chip } from '../../components/ui/Chip'
import type { ProposalView } from '../../domain/api'
import { fmtDayNumeric } from '../../lib/formatters'
import { useHashFocus } from '../../lib/pageFocus'
import { SettingsSection } from '../../pages/admin/ui/SettingsSection'
import { agreedVotes, memberName } from './cardLines'
import { GoalAction } from './CreateGoalDialog'
import { ProposalCard } from './ProposalCard'
import { cancelProposalFocus } from './proposalFocus'
import { useProposals } from './useProposals'

const P = 'modules.advisor.proposals'
const H = 'modules.advisor.history'

const isWaiting = (p: ProposalView) => p.status === 'open' || p.status === 'revising'

/** The proposal the address points at: `#proposal-<id>`, read once when the page opens. */
function useLinkedProposal(): number | null {
  const [id] = useState(() => {
    const match = /^#proposal-(\d+)$/.exec(window.location.hash)
    return match ? Number(match[1]) : null
  })
  return id
}

/** A decided proposal: its status, title (the toggle of its card), author, date, who agreed, and the goal of a goal decision. */
function HistoryItem({ proposal, canCreateGoal, open, onToggle, created, onCreated }: {
  proposal: ProposalView; canCreateGoal: boolean; open: boolean; onToggle: () => void; created: string | null; onCreated: (goalId: string) => void
}) {
  const { t } = useTranslation()
  const panelId = useId()
  const agreed = agreedVotes(proposal.current).map(v => v.member)
  return (
    <li className="proposal-history__item">
      <div className="proposal-history__row">
        <Chip color={proposal.status === 'accepted' ? 'success' : 'secondary'}>{t(`${P}.status.${proposal.status}`)}</Chip>
        <button type="button" id={`proposal-row-${proposal.id}`} className="link-button proposal-history__title" aria-expanded={open} aria-controls={panelId}
          onClick={onToggle}>{proposal.current.title}<DisclosureChevron size={16} /></button>
      </div>
      <p className="proposal__meta">
        {t(`${H}.by`, {
          author: memberName(t, proposal.author.member),
          when: t(`${P}.when.${proposal.status}`, { date: fmtDayNumeric(proposal.decidedAt) }),
        })}
      </p>
      {proposal.status === 'accepted' && agreed.length > 0 && <p className="proposal-history__support">{t(`${H}.agreed`, { list: agreed.join(', ') })}</p>}
      <GoalAction proposal={proposal} canCreateGoal={canCreateGoal} created={created} onCreated={onCreated} />
      <div id={panelId}>{open && <ProposalCard proposal={proposal} />}</div>
    </li>
  )
}

export function ProposalsSection() {
  const { t } = useTranslation()
  const query = useProposals()
  const linked = useLinkedProposal()
  /** The history rows the person opened or closed: the one the address names starts open, the others closed */
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set())
  const isOpen = (id: number) => (id === linked) !== toggled.has(id)
  /** The goals made here whose link to the proposal failed: the next press links them, never a second goal */
  const [created, setCreated] = useState<Readonly<Record<number, string>>>({})
  const data = query.data
  // the card the address names (a decided one open in its row) takes the focus once the data is drawn
  useHashFocus(!!data)
  useEffect(() => cancelProposalFocus, [])

  const proposals = (
    <SettingsSection stacked title={t(`${P}.title`)} description={t(`${P}.text`)}>
      {query.isPending ? <Loading className="reminder-state" />
        : query.isError ? <PageError className="reminder-state" />
          : query.data.proposals.some(isWaiting) ? (
              <div className="proposal-list">
                {query.data.proposals.filter(isWaiting).map(p => <ProposalCard key={p.id} proposal={p} />)}
              </div>
            ) : <p className="reminder-state">{t(`${P}.none`)}</p>}
    </SettingsSection>
  )
  if (!data) return proposals

  const decided = data.proposals.filter(p => !isWaiting(p))
  const toggle = (id: number) => setToggled(s => {
    const next = new Set(s)
    if (!next.delete(id)) next.add(id)
    return next
  })
  return (
    <>
      {proposals}
      <SettingsSection stacked title={t(`${H}.title`)} description={t(`${H}.text`)}>
        {decided.length === 0 ? <p className="reminder-state">{t(`${H}.none`)}</p> : (
          <ul className="proposal-history">
            {decided.map(p => (
              <HistoryItem key={p.id} proposal={p} canCreateGoal={data.canCreateGoal} open={isOpen(p.id)} onToggle={() => toggle(p.id)}
                created={created[p.id] ?? null} onCreated={goalId => setCreated(c => ({ ...c, [p.id]: goalId }))} />
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  )
}
