import { useTranslation } from 'react-i18next'
import { MetricExplainer } from '../../components/cards/MetricExplainer'
import { Card } from '../../components/ui/Card'
import { Disclosure, DisclosureGroup } from '../../components/ui/Disclosure'
import { Link } from '../../components/ui/Link'
import { ANNUAL_RETURN } from '../../domain/goals'
import type { FinanceSnapshot } from '../../domain/types'
import { fmtNum, fmtPct } from '../../lib/formatters'
import { beyondSavingsNotes, explanationFacts, type GoalMetrics } from '../../lib/snapshotSelectors'

/**
 * Independence's «Forecasts», a closed row: the growth per year over the whole history against the growth the goal needs,
 * the growth beyond the family's own savings, the capital that grows to the goal on its own, and the real return.
 */
export function Forecasts({ data, snapshot, fmt }: { data: GoalMetrics; snapshot: FinanceSnapshot; fmt: (v: number) => string }) {
  const { t } = useTranslation()
  const coast = data.fire?.coastFire ?? null
  const hint = data.actualCagrPct !== null && data.requiredCagrPct !== null
    ? t('pages.goals.forecastsHint', { actual: fmtPct(data.actualCagrPct, { sign: true }), required: fmtPct(data.requiredCagrPct, { sign: true }) })
    : undefined
  const inflation = data.inflation
  // growth beyond savings: null while income and expenses are not tracked; its note says how many months it rests on, how many it still needs,
  // or, with enough months and no annual rate, that a month lost everything and broke the chain
  const beyond = data.beyondSavings
  const beyondNote = beyond === null ? t('pages.goals.beyond.needCashflow')
    : beyond.months.length < beyond.minMonths ? t('pages.goals.beyond.tooFew', { min: beyond.minMonths, used: beyond.months.length })
      : beyond.annualRate === null ? t('pages.goals.beyond.collapsed')
        : t('pages.goals.beyond.note', { used: beyond.months.length, count: beyond.monthsConsidered })
  return (
    <DisclosureGroup>
      <Disclosure title={t('pages.goals.forecasts')} hint={hint}>
        {/* two by two: the growth figures side by side (with the family's savings and without them), then coast and real return */}
        <div className="rg-halves rg-halves--stretch">
          <Card className="stat">
            <div className="card-hd card-hd--row">
              <span>{t('pages.goals.cagr.title')}</span>
              <MetricExplainer metric="capital_growth" facts={explanationFacts(snapshot, 'capital_growth')} />
            </div>
            <div className="stat__value">{fmtPct(data.actualCagrPct, { sign: true })}</div>
            <div className="note">
              {data.requiredCagrPct === null ? t('pages.goals.cagr.unknown') : t('pages.goals.cagr.required', { value: fmtPct(data.requiredCagrPct, { sign: true }) })}
            </div>
            {/* the growth itself is the History section on Assets; here it is set against the required pace */}
            <div className="note">
              <Link to="/assets#history" className="link-accent">{t('pages.goals.seeNetWorth')}</Link>
            </div>
          </Card>
          <Card className="stat">
            <div className="card-hd card-hd--row">
              <span>{t('pages.goals.beyond.title')}</span>
              {beyond && (
                <MetricExplainer metric="growth_beyond_savings" facts={explanationFacts(snapshot, 'growth_beyond_savings')} notes={beyondSavingsNotes(beyond, fmt)} />
              )}
            </div>
            <div className="stat__value">{fmtPct(data.beyondSavingsPct, { sign: true })}</div>
            <div className="note">{beyondNote}</div>
          </Card>
          <Card className="stat">
            <div className="card-hd">{t('pages.goals.coast.title')}</div>
            <div className="stat__value">{coast === null ? '—' : coast.reached ? t('pages.goals.coast.reached') : fmt(coast.gapBase)}</div>
            <div className="note">
              {coast === null ? t('pages.goals.coast.needGoal')
                : coast.reached ? t('pages.goals.coast.reachedNote')
                  : t('pages.goals.coast.gapNote')}
            </div>
          </Card>
          <Card className="stat">
            <div className="card-hd">{t('pages.goals.real.title')}</div>
            <div className="stat__value">{fmtPct(data.realReturnPct, { sign: true })}</div>
            <div className="note">
              {inflation === null ? t('pages.goals.real.noInflation') : t('pages.goals.real.note', { rate: fmtNum(ANNUAL_RETURN * 100, 0), inflation: fmtNum(inflation.ratePct), currency: inflation.currency })}
            </div>
          </Card>
        </div>
      </Disclosure>
    </DisclosureGroup>
  )
}
