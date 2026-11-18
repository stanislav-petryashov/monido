import { METRICS, type MetricKey } from '../../../src/domain/metricCatalog'
import { buildMetricPrompt, buildMetricPromptBlocks, promptText, type PromptFormat } from '../../../src/modules/claude-prompts/prompts'
import { missingBalanceWarning, missingCashflowWarning } from '../../../src/domain/snapshot'
import { emptySnapshot, makeSnapshot } from '../../helpers/snapshot'
import { DEMO_FAMILIES } from '../../../src/demo/family'
import { ru, withLanguage } from '../../helpers/i18n'

const usd: PromptFormat = { money: v => `$${Math.round(v)}`, currencyName: 'US dollars', converted: false }
const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]

describe('buildMetricPrompt', () => {
  const prompt = buildMetricPrompt(makeSnapshot(), 'emergency_months', usd)

  it('states the currency and asks to rely on the given numbers only', () => {
    expect(prompt).toContain('Currency of amounts: US dollars.')
    expect(prompt).toContain('Rely only on these numbers')
  })

  it('gives the real-growth net worths in the inflation currency, so they reproduce the value', () => {
    const inflation = { ratePct: 8, currency: 'RUB', netWorthNow: 1_100_000, netWorthYearAgo: 1_000_000 }
    const s = makeSnapshot({ inflation })
    const real = buildMetricPrompt(s, 'real_growth_yoy', usd)
    expect(real).toContain('- Net worth now: ₽1,100,000')
    expect(real).toContain('- Net worth a year ago: ₽1,000,000')
    expect(real).toContain('- Inflation used in the calculation, RUB: 8%')
    expect(real).not.toContain('- Net worth now: $')
  })

  it('describes the metric with zone, norm and parts', () => {
    expect(prompt).toContain('## Metric: Emergency fund')
    expect(prompt).toContain('Value: 1.8 mo, zone “Needs work” (norm: above 3 and up to 6 mo; above 6 mo is excellent)')
    expect(prompt).toContain('How it is calculated: Liquid (bank) accounts ÷ average monthly expenses over the last 12 closed months.')
    expect(prompt).toContain('- Average expenses over 12 mo: $10120')
    expect(prompt).toContain('- Liquid accounts: $19268')
    expect(prompt).toContain('- Average expenses over 3 mo: $10010')
  })

  it('adds a short picture of the whole family finances', () => {
    expect(prompt).toContain('## Overall picture (closed month: June 2031)')
    expect(prompt).toContain('- Net worth: $136673 ($-820 over the month); assets $184508, loans $47835')
    expect(prompt).toContain('- Loans: City apartment mortgage $43963 at 10.4%; Car loan $3872 at 11.2%')
    expect(prompt).toContain('- Goals: FIRE 40.9%; $7240/mo short of goal contributions')
    // the emergency fund is not repeated in the summary when it is the metric itself
    expect(prompt).not.toContain('- Emergency fund:')
    expect(buildMetricPrompt(makeSnapshot(), 'net_worth', usd)).toContain('- Emergency fund: 1.8 mo of expenses')
  })

  it('keeps savings rate and the cushion when the health module is off', () => {
    const s = makeSnapshot({ health: null })
    expect(buildMetricPrompt(s, 'emergency_months', usd)).toContain('Value: 1.8 mo')
    const net = buildMetricPrompt(s, 'net_worth', usd)
    expect(net).toContain('- Savings rate: −55.7% over the month')
    expect(net).toContain('- Emergency fund: 1.8 mo of expenses')
  })

  it('lists data warnings and ends with the question', () => {
    expect(prompt).toContain('## Data warnings\n- No RUB rate for 2031-07-01; the rate for 2031-06-30 was used')
    expect(prompt).toMatch(/## Question\nExplain in plain words.*Suggest 3 concrete actions for the coming month.* Answer in English\.$/s)
    expect(buildMetricPrompt(makeSnapshot(), 'liabilities', usd)).toContain('Which loan should we pay off first')
  })

  it('never mentions family member names', () => {
    for (const key of METRIC_KEYS) {
      const text = buildMetricPrompt(makeSnapshot(), key, usd)
      expect(text, key).not.toMatch(new RegExp(DEMO_FAMILIES['en-US'].members.join('|')))
    }
  })

  it('asks for the missing data when the metric is not computed', () => {
    const s = makeSnapshot()
    s.health!.metrics.emergency_months = { value: null, zone: null }
    s.cashflow.emergencyMonths = null
    const text = buildMetricPrompt(s, 'emergency_months', usd)
    expect(text).toContain('Value: no data')
    expect(text).toContain('The value is not computed. Explain which data is missing and how to collect it.')
  })

  it('builds every metric on an empty database without throwing', () => {
    for (const key of METRIC_KEYS) {
      const text = buildMetricPrompt(emptySnapshot(), key, usd)
      expect(text, key).toContain('The value is not computed')
      expect(text, key).not.toContain('## Overall picture')
    }
  })

  it('stays under 3000 characters even with many warnings and loans', () => {
    const base = makeSnapshot()
    const s = makeSnapshot({
      warnings: Array.from({ length: 20 }, (_, i) => ({ code: 'missing_balance' as const, params: { name: `Account ${i + 1}`, member: 'x', month: '2031-06' } })),
      capital: { ...base.capital!, loans: Array.from({ length: 10 }, (_, i) => ({ ...base.capital!.loans[0], name: `Loan ${i + 1}` })) },
    })
    for (const key of METRIC_KEYS) {
      expect(buildMetricPrompt(s, key, usd).length, key).toBeLessThan(3000)
    }
    expect(buildMetricPrompt(s, 'net_worth', usd)).toContain('- …and 15 more')
    expect(buildMetricPrompt(s, 'net_worth', usd)).toContain('; 7 more')
  })
})

describe('prompt details', () => {
  it('keeps member names out of data warnings, using the real warning texts', () => {
    const s = makeSnapshot({ warnings: [
      missingBalanceWarning('Brisaluna Bank', 'Robin', '2031-05'),
      missingCashflowWarning('Lumiora Bank', 'Noa', '2031-05'),
    ] })
    const text = buildMetricPrompt(s, 'net_worth', usd)
    expect(text).toContain('- No balance for “Brisaluna Bank” in 2031-05')
    expect(text).toContain('- No income and expenses for “Lumiora Bank” in 2031-05')
    expect(text).not.toMatch(/Robin|Noa/)
  })

  describe('a member name is replaced only as a whole word', () => {
    const scrub = (...warnings: ReturnType<typeof missingBalanceWarning>[]) => buildMetricPrompt(makeSnapshot({ warnings }), 'net_worth', usd)

    it('the longer name first: "Ari" before "Ariadne" leaves no fragment of either', () => {
      // names apart from the fixture's family, so that "Ari" is met first
      const text = scrub(missingBalanceWarning('Ari savings', 'Ari', '2031-05'), missingBalanceWarning('Ariadne fund', 'Ariadne', '2031-05'))
      expect(text).toContain('No balance for “member savings”')
      expect(text).toContain('No balance for “member fund”')
      expect(text).not.toMatch(/Ari|memberadne/)
    })

    it('a short name inside a word leaves the word alone', () => {
      const text = scrub(missingBalanceWarning('Also Bank', 'Al', '2031-05'), missingBalanceWarning('Al card', 'Al', '2031-05'))
      expect(text).toContain('“Also Bank”')
      expect(text).toContain('“member card”')
    })

    it('a regex special char in a name is the char itself', () => {
      const text = scrub(missingBalanceWarning('Jo.e card', 'Jo.e', '2031-05'), missingBalanceWarning('Joxe Bank', 'Rob', '2031-05'))
      expect(text).toContain('“member card”')
      expect(text).toContain('“Joxe Bank”')
    })

    it('a name in another script keeps its letter boundaries', () => {
      // a Cyrillic name, spelled by code points: the noCyrillic guard keeps the letters out of the source
      const anna = String.fromCodePoint(0x410, 0x43d, 0x43d, 0x430)
      const text = scrub(missingBalanceWarning(`${anna} fund`, anna, '2031-05'), missingBalanceWarning(`${anna}bel Bank`, 'Rob', '2031-05'))
      expect(text).toContain('“member fund”')
      expect(text).toContain(`“${anna}bel Bank”`)
    })
  })

  it("explains that amounts were converted at each date's rate", () => {
    const rub: PromptFormat = { money: v => `${Math.round(v * 83)} ₽`, currencyName: 'Russian rubles', converted: true }
    expect(buildMetricPrompt(makeSnapshot(), 'net_worth', rub))
      .toContain("Currency of amounts: Russian rubles; each amount is converted at the rate of its own date, goals at today's rate.")
  })

  it('the savings-rate prompt carries the closed month and both comparison windows', () => {
    const text = buildMetricPrompt(makeSnapshot(), 'savings_rate', usd)
    expect(text).toContain('Value: −55.7%')
    expect(text).toContain('- 3-month average: −52.4%')
    expect(text).toContain('- 12-month average: −61%')
  })
})

describe('buildMetricPromptBlocks', () => {
  it('splits the prompt into typed blocks that join into exactly the copied text', () => {
    const blocks = buildMetricPromptBlocks(makeSnapshot(), 'emergency_months', usd)
    expect(blocks.map(b => b.kind)).toEqual(['intro', 'metric', 'summary', 'warnings', 'question'])
    expect(blocks[1].heading).toBe('Metric: Emergency fund')
    expect(blocks[4].heading).toBe('Question')
    expect(promptText(blocks)).toBe(buildMetricPrompt(makeSnapshot(), 'emergency_months', usd))
  })

  it('skips the summary and warnings blocks when there is nothing to say', () => {
    expect(buildMetricPromptBlocks(emptySnapshot(), 'net_worth', usd).map(b => b.kind)).toEqual(['intro', 'metric', 'question'])
  })

  it('shows member-free text in the blocks too', () => {
    const s = makeSnapshot({ warnings: [missingBalanceWarning('Brisaluna Bank', 'Robin', '2031-05')] })
    const shown = buildMetricPromptBlocks(s, 'net_worth', usd).map(b => `${b.heading ?? ''} ${b.body}`).join(' ')
    expect(shown).not.toMatch(/Robin/)
  })

  it.each([
    ['balance', missingBalanceWarning],
    ['cashflow', missingCashflowWarning],
  ] as const)('scrubs owners known only from a historical %s warning from every block', async (_, warning) => {
    const base = makeSnapshot()
    const s = makeSnapshot({
      capital: { ...base.capital!, loans: [{ ...base.capital!.loans[0], name: 'Avery mortgage' }] },
      warnings: [warning('Avery savings', 'Avery', '2031-05')],
    })
    for (const language of ['en-US', 'ru-RU'] as const) {
      await withLanguage(language, () => {
        for (const key of METRIC_KEYS) {
          const blocks = buildMetricPromptBlocks(s, key, usd)
          for (const block of blocks) {
            expect(`${block.heading ?? ''} ${block.body}`, `${language}: ${key}: ${block.kind}`).not.toContain('Avery')
          }
          const text = promptText(blocks)
          const member = language === 'en-US' ? 'member' : ru('modules.claude_prompts.prompt.member')
          expect(text).toContain(`${member} savings`)
          expect(text).toContain(`${member} mortgage`)
        }
      })
    }
  })
})

describe('year question', () => {
  it('asks what drove capital over the year only when a year of history exists', () => {
    expect(buildMetricPrompt(makeSnapshot(), 'net_worth', usd)).toContain('What moved our net worth the most over the past year?')
    const base = makeSnapshot()
    const young = makeSnapshot({ capital: { ...base.capital!, yoyDelta: null } })
    expect(buildMetricPrompt(young, 'net_worth', usd)).not.toContain('past year')
  })
})

describe('prompt language', () => {
  const P = 'modules.claude_prompts.prompt'

  it('is built in the UI language, the answer language included', async () => {
    expect(buildMetricPrompt(makeSnapshot(), 'net_worth', usd).endsWith(' Answer in English.')).toBe(true)
    await withLanguage('ru-RU', () => {
      const text = buildMetricPrompt(makeSnapshot(), 'net_worth', { ...usd, currencyName: 'US dollars' })
      expect(text.startsWith(`${ru(`${P}.role`)} ${ru(`${P}.ratesData`, { currency: 'US dollars' })} ${ru(`${P}.only`)}`)).toBe(true)
      expect(text).toContain(`## ${ru(`${P}.metricHeading`, { title: ru('metrics.net_worth.title') })}`)
      expect(text.endsWith(` ${ru(`${P}.actions`)} ${ru(`${P}.answerIn`)}`)).toBe(true)
    })
  })

  it('scrubs the owner of a property, who has no account or loan of their own', () => {
    const base = makeSnapshot()
    const realEstate = [{ ...base.capital!.realEstate[0], member: 'Zed' }]
    const loans = [{ ...base.capital!.loans[0], name: 'Zed mortgage' }]
    const s = makeSnapshot({
      capital: { ...base.capital!, realEstate, loans },
      warnings: [missingBalanceWarning('Zed fund', 'Robin', '2031-05')],
    })
    for (const key of ['liabilities', 'net_worth'] as const) {
      const text = buildMetricPrompt(s, key, usd)
      expect(text).not.toContain('Zed')
    }
    expect(buildMetricPrompt(s, 'liabilities', usd)).toContain('member mortgage')
  })

  it('puts the word for a member in place of a member name, in the UI language', async () => {
    const base = makeSnapshot()
    const loans = [{ ...base.capital!.loans[0], name: `${base.capital!.loans[0].member} mortgage` }]
    const s = makeSnapshot({ capital: { ...base.capital!, loans } })
    expect(buildMetricPrompt(s, 'liabilities', usd)).toContain('member mortgage')
    await withLanguage('ru-RU', () => {
      expect(buildMetricPrompt(s, 'liabilities', usd)).toContain(`${ru(`${P}.member`)} mortgage`)
    })
  })
})

it('uses explicit warning members without parsing an account reference', () => {
  const text = buildMetricPrompt(makeSnapshot({ warnings: [
    { code: 'missing_balance', ref: 'opaque-reference', params: { name: 'A|B', member: 'C|D', month: '2031-05' } },
  ] }), 'net_worth', usd)
  expect(text).toContain('No balance for “A|B” in 2031-05')
  expect(text).not.toContain('(member)')
})

describe('a prompt states only what is known', () => {
  it('a month with an account\'s balance missing gives its assets and net worth as unknown, not the partial sum', () => {
    const s = makeSnapshot()
    const month = s.capital!.date.slice(0, 7)
    s.capitalCoverage = [{ month, assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [] }]
    const text = buildMetricPrompt(s, 'net_worth', usd)
    expect(text).not.toContain(`$${Math.round(s.capital!.assets)}`)
    expect(text).toMatch(/assets —/i)
  })

  it('a member with no records of their own is still scrubbed out of a record\'s name', () => {
    const s = makeSnapshot({ members: ['Mila'] })
    s.capital = { ...s.capital!, loans: [...s.capital!.loans, { ...s.capital!.loans[0], name: 'Mila tuition loan', member: 'Robin' }] }
    expect(buildMetricPrompt(s, 'net_worth', usd)).not.toMatch(/\bMila\b/)
  })
})
