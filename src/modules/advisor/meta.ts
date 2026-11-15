import type { ModuleMeta } from '../types'

export const advisorMeta: ModuleMeta = {
  key: 'advisor',
  // the council (migration 0023) and its settings row. oauth_clients and oauth_tokens (migration 0020) are credentials,
  // not module data: emptied by a wipe, kept live by a restore
  tables: ['proposal_votes', 'proposal_messages', 'proposal_versions', 'proposals', 'advisor_settings'],
  // Claude's connector reaches Anthropic
  notInDemo: true,
}
