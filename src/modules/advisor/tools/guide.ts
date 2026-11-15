import { ADVISOR_GUIDE } from '../guide'
import type { AdvisorTool } from './registry'

export const getAdvisorGuide: AdvisorTool = {
  name: 'get_advisor_guide',
  description: 'The advisor guide: how to consult the family about a purchase, a loan or a goal, what to ask, what every answer covers and how to treat the data. Read it first, once per conversation.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  right: null,
  async run() { return { guide: ADVISOR_GUIDE } },
}
