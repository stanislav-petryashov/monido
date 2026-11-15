import { familyOverview } from '../../../domain/advisorOverview'
import { ANSWER_RULES } from '../guide'
import { advisorSnapshot } from './snapshot'
import type { AdvisorTool } from './registry'

export const getFamilyOverview: AdvisorTool = {
  name: 'get_family_overview',
  description: 'The family as it is now, in the family currency: the 3-month average income and expenses, savings, what is left for living, the loan payment share, the emergency fund, the loans, the goals and their plan (the financial-independence goal\'s projected month includes an assumed 8% return a year on what it holds), each member\'s income share, the income sources by category (incomeSources: a month\'s average per category, with its flow and the one-off flag) and the income a month left unallocated, the health metrics and the data gaps. Call it before advising; every amount is computed by the server. Follow answerRules in your answer.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  right: null,
  async run(ctx) { return { ...familyOverview(await advisorSnapshot(ctx), ctx.now), answerRules: ANSWER_RULES } },
}
