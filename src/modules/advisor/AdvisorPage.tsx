import { useEffect } from 'react'
import { navigate } from '../../lib/router'
import '../../styles/admin.css'
import './advisor.css'
import { CouncilSettings } from './CouncilSettings'
import { ProposalsSection } from './ProposalsSection'
import { useProposals } from './useProposals'

/**
 * The first tab of Advisor: what the family decides together, its history (the Overview item and the Telegram cards link
 * here) and the settings for who may manage them. Proposals need sign-in through Telegram: without it this is not what
 * anyone came for, so Advisor opens on asking Claude, which says why.
 */
export function AdvisorPage() {
  const proposals = useProposals()
  const unavailable = proposals.data?.available === false
  useEffect(() => { if (unavailable) navigate('/advisor/ask', { replace: true }) }, [unavailable])
  // until the answer: no headings of a page that may turn out not to apply
  if (unavailable || proposals.isPending) return null
  return (
    <div className="advisor-page">
      <ProposalsSection />
      <CouncilSettings />
    </div>
  )
}
