// The Advisor page's council reads and writes: the proposals with the settings, a vote or a comment from the site,
// Withdraw, the goal made from a proposal, the council settings. Each write answers the new state, which replaces the
// cached one (the menu's second floor reads the same view, so its "Vote: …" rows follow). A refused write reads the proposals again.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdvisorSettings, CommentRequest, LinkGoalRequest, ProposalsView, VoteRequest } from '../../domain/api'
import { t } from '../../i18n/client'
import { apiSend } from '../../lib/api'
import { useToast } from '../../lib/notifyState'
import { PROPOSALS_URL as BASE, proposalsQuery } from './proposalsQuery'

const P = 'modules.advisor.proposals'

/** The open and revising proposals, then the decided ones; the settings; whether the person may create a goal. */
export const useProposals = () => useQuery(proposalsQuery)

/** A write whose answer is the new ProposalsView; a failure is told with `fail` and the server's reason. */
function useProposalWrite<V>(send: (vars: V) => Promise<ProposalsView>, fail: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: send,
    onSuccess: view => {
      queryClient.setQueryData(proposalsQuery.queryKey, view)
    },
    onError: e => {
      toast.error(t(`${P}.${fail}`), e)
      // refused for a state the page did not show (a new version, a decision meanwhile): read the current one
      void queryClient.invalidateQueries({ queryKey: proposalsQuery.queryKey })
    },
  })
}

const url = (id: number, action: string) => `${BASE}/${id}/${action}`

/** Agree or Against from the site, settled at once, with an optional comment. */
export const useVote = () => useProposalWrite(({ id, ...body }: VoteRequest & { id: number }) =>
  apiSend<ProposalsView>(url(id, 'votes'), 'POST', body), 'voteFailed')

/** A comment added to one's own counted agree. */
export const useAddComment = () => useProposalWrite(({ id, ...body }: CommentRequest & { id: number }) =>
  apiSend<ProposalsView>(url(id, 'comment'), 'POST', body), 'commentFailed')

/** The author withdraws an open or revising proposal. */
export const useWithdraw = () => useProposalWrite((id: number) => apiSend<ProposalsView>(url(id, 'withdraw'), 'POST'), 'withdrawFailed')

/** Links an accepted proposal to the goal just made from it. */
export const useLinkGoal = () => useProposalWrite(({ id, goalId }: LinkGoalRequest & { id: number }) =>
  apiSend<ProposalsView>(url(id, 'goal'), 'PUT', { goalId }), 'linkFailed')

/** Days to decide and the reminder; the answer is the stored settings. */
export function useSaveCouncilSettings() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (settings: AdvisorSettings) => apiSend<AdvisorSettings>('/api/advisor/settings', 'PUT', settings),
    onSuccess: settings => {
      queryClient.setQueryData(proposalsQuery.queryKey, view => view && { ...view, settings })
      toast.success(t(`${P}.settingsSaved`))
    },
    onError: e => toast.error(t(`${P}.settingsFailed`), e),
  })
}
