// The advisor's rows on the menu's second floor: the open proposals waiting for the signed-in person's vote, each by its
// title. In the initial bundle (the menu is not lazy), so it is kept to one query and one key; the page's writes replace
// the cached view (useProposals.ts), so a vote given there takes its row away at once.
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { IconMessageCircleQuestion } from '@tabler/icons-react'
import type { TodoItem } from '../client'
import { proposalsQuery } from './proposalsQuery'

/** "Vote: A car on credit", one per open proposal the person is a voter on and has no counted vote yet; none while loading, on an error or without the council. */
export function useProposalsTodo(): TodoItem[] {
  const { t } = useTranslation()
  const proposals = useQuery(proposalsQuery).data?.proposals ?? []
  return proposals
    // open, among the voters, and no settled vote of theirs (a provisional bot vote still waits)
    .filter(p => p.status === 'open' && p.you.voter && !p.you.settled)
    .map(p => ({ key: `proposal-${p.id}`, to: '/advisor', icon: IconMessageCircleQuestion, label: t('modules.advisor.todoProposal', { title: p.current.title }) }))
}
