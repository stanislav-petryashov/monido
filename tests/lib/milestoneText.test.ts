import { LOCALE_CHUNKS, loadChunkMessages } from '../../src/i18n/chunks'
import { createI18n } from '../../src/i18n/core'
import { milestoneText } from '../../src/lib/milestoneText'
import type { Milestone } from '../../src/domain/types'
import { ru } from '../helpers/i18n'

const english = await createI18n('en-US')
for (const chunk of LOCALE_CHUNKS) english.addResourceBundle('en-US', 'translation', structuredClone(await loadChunkMessages(chunk, 'en-US')), true, true)
const en = english.getFixedT('en-US')
const added: Milestone = { month: '2025-09', kind: 'addedThisYear', level: 6, params: { months: 6 }, headline: true, celebrated: true }
const fmt = (v: number) => String(v)

// the sentence names its year: under "September 2025" in a past period, "this year" would read as the current one
describe('milestoneText', () => {
  it('says which year the family added its months of expenses in', () => {
    expect(milestoneText((k, p) => en(k, p), added, fmt)).toBe('In 2025 you added 6 months of your expenses.')
    expect(milestoneText(ru, added, fmt)).toContain('2025')
    expect(milestoneText(ru, { ...added, level: 3 }, fmt)).toContain('2025')
  })
})
