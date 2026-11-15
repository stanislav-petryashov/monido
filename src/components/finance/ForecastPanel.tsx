import { Select } from '../../pages/admin/ui/Select'
import { useAvailability } from '../../lib/useAvailability'
import { Link } from '../ui/Link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { forecastCash, historicalBudget, type ForecastInput } from '../../domain/financialAnalysis'
import type { FinanceSnapshot } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { Disclosure } from '../ui/Disclosure'
import { QuestionAnswer } from './QuestionPanel'
import { ThemedChart } from '../charts/ThemedChart'
import '../charts/chartLegend'
import { AmountInput } from '../../pages/admin/ui/AmountInput'
import { NumberInput } from '../../pages/admin/ui/NumberInput'
import { Field } from '../../pages/admin/ui/Field'
import { resolveColor } from '../../lib/chartColors'

const FIELDS = ['starting', 'income', 'expense', 'reserve', 'goalContribution', 'incomeLossPct', 'lossMonths', 'expenseIncreasePct', 'purchase', 'purchaseMonth'] as const
/** A new month or currency starts a new draft: numeric assumptions cannot leak between currencies. */
export function ForecastPanel({ snapshot }: { snapshot: FinanceSnapshot }) {
  return <ForecastDraft key={`${snapshot.baseCurrency}/${snapshot.asOf.capitalDate}/${snapshot.asOf.closedMonth}`} snapshot={snapshot} />
}
function ForecastDraft({ snapshot }: { snapshot: FinanceSnapshot }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const availability = useAvailability(snapshot)
  const history = historicalBudget(snapshot)
  const defaults = () => ({ starting: '', income: history ? String(history.income) : '', expense: history ? String(history.expense) : '', reserve: '0', goalContribution: '0', incomeLossPct: '0', lossMonths: '3', expenseIncreasePct: '0', purchase: '0', purchaseMonth: '1' })
  const [fields, setFields] = useState(defaults)
  const [imported, setImported] = useState<Record<string, string> | null>(null)
  const [horizon, setHorizon] = useState<3 | 6 | 12>(6)
  const month = snapshot.asOf.closedMonth
  const canImport = availability.query.isSuccess && availability.aggregate.free !== null && availability.aggregate.reserve !== null && snapshot.asOf.capitalDate?.slice(0, 7) === month
  const source = () => ({ date: snapshot.asOf.capitalDate ?? '—', currency: snapshot.baseCurrency, starting: fmt(availability.aggregate.free! + availability.aggregate.reserve!), reserve: fmt(availability.aggregate.reserve!), goals: fmt(availability.aggregate.goals!), commitments: fmt(availability.aggregate.commitments!) })
  const amounts = Object.fromEntries(FIELDS.map(key => [key, fields[key].trim() === '' ? NaN : Number(fields[key])])) as Omit<ForecastInput, 'month' | 'horizon'>
  const result = month ? forecastCash({ ...amounts, month, horizon }) : null
  const renderField = (key: typeof FIELDS[number]) => {
    const label = t(`financialQuestions.forecast.${key}`)
    const onChange = (value: string) => setFields(f => ({ ...f, [key]: value }))
    const money = ['starting', 'income', 'expense', 'reserve', 'goalContribution', 'purchase'].includes(key)
    const max = key === 'incomeLossPct' ? 100 : key === 'lossMonths' ? 12 : key === 'purchaseMonth' ? horizon : key === 'expenseIncreasePct' ? 300 : Infinity
    const value = fields[key].trim() === '' ? null : Number(fields[key])
    const invalid = value !== null && (value > max || (key === 'purchaseMonth' && value < 1))
    return <Field variant="comfortable" key={key} label={label}>{money
      ? <AmountInput label={label} unit={snapshot.baseCurrency} value={fields[key]} onChange={onChange} />
      : <NumberInput label={label} value={fields[key]} onChange={onChange} decimals={key === 'lossMonths' || key === 'purchaseMonth' ? 0 : 2} invalid={invalid} invalidMessage={t('financialQuestions.forecast.invalidInputs')} />}</Field>
  }
  return <QuestionAnswer id="forecast"
    answer={result ? t('financialQuestions.forecast.answer', { amount: fmt(result.minimum) }) : t(FIELDS.every(key => fields[key].trim() !== '') ? 'financialQuestions.forecast.invalidInputs' : 'financialQuestions.forecast.needInputs')}>
    <p className="note">{t('financialQuestions.forecast.assumptions', { currency: snapshot.baseCurrency, month: month ? fmtMonth(month) : '—' })}</p>
    <div className="financial-links">
      {canImport && <button type="button" className="btn btn--ghost" onClick={() => { setFields({ ...fields, starting: String(availability.aggregate.free! + availability.aggregate.reserve!), reserve: String(availability.aggregate.reserve!) }); setImported(source()) }}>{t('financialQuestions.forecast.useConfirmed')}</button>}
      <Link to="/available-money" className="link-accent">{t('financialQuestions.reserveLink')}</Link>
    </div>
    {imported ? <p className="note" role="status">{t('financialQuestions.forecast.confirmSource', imported)} {t('financialQuestions.forecast.importEditable')}</p> : <p className="note">{availability.query.isPending ? t('common.loading') : canImport ? t('financialQuestions.forecast.confirmSource', source()) : t('financialQuestions.forecast.confirmUnavailable')}</p>}
    <Disclosure variant="inline" initiallyOpen title={t('financialQuestions.forecast.settings')}>
      <div className="financial-controls">
        {FIELDS.slice(0, 5).map(renderField)}
        <Field variant="comfortable" label={t('financialQuestions.forecast.horizon')}><Select value={horizon} onChange={e => setHorizon(Number(e.target.value) as 3 | 6 | 12)}>
          {[3, 6, 12].map(n => <option value={n} key={n}>{t('financialQuestions.months', { count: n })}</option>)}
        </Select></Field>
      </div>
      <Disclosure variant="inline" title={t('financialQuestions.forecast.stressControls')}><div className="financial-controls">{FIELDS.slice(5).map(renderField)}</div></Disclosure>
      <button type="button" className="btn btn--ghost" onClick={() => { setFields(defaults()); setHorizon(6); setImported(null) }}>{t('financialQuestions.forecast.reset')}</button>
    </Disclosure>
    {result && <>
      <h3 className="financial-question__heading">{t('financialQuestions.forecast.results')}</h3>
      <dl className="financial-values">
        <div><dt>{t('financialQuestions.forecast.belowReserve')}</dt><dd>{result.belowReserve ? fmtMonth(result.belowReserve) : t('financialQuestions.forecast.notReached')}</dd></div>
        <div><dt>{t('financialQuestions.forecast.negative')}</dt><dd>{result.negative ? fmtMonth(result.negative) : t('financialQuestions.forecast.notReached')}</dd></div>
      </dl>
      <ThemedChart height={260} buildOption={() => ({
        aria: { enabled: true }, legend: { top: 0 }, grid: { left: 8, right: 12, top: 45, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: result.points.map(p => fmtMonth(p.month)) }, yAxis: { type: 'value', axisLabel: { formatter: fmt } },
        series: [
          { name: t('financialQuestions.forecast.baseline'), type: 'line', data: result.points.map(p => p.baseline), itemStyle: { color: resolveColor('--chart-2') } },
          { name: t('financialQuestions.forecast.stress'), type: 'line', data: result.points.map(p => p.stress), itemStyle: { color: resolveColor('--primary') } },
          { name: t('financialQuestions.forecast.reserve'), type: 'line', symbol: 'none', data: result.points.map(() => amounts.reserve), lineStyle: { type: 'dashed' }, itemStyle: { color: resolveColor('--text-3') } },
        ],
      })} />
      <Disclosure variant="inline" title={t('financialQuestions.forecast.monthly')}><dl className="financial-values">{result.points.map(p => <div key={p.month}><dt>{fmtMonth(p.month)}</dt><dd>{t('financialQuestions.forecast.values', { base: fmt(p.baseline), stress: fmt(p.stress) })}</dd></div>)}</dl></Disclosure>
    </>}
    <p className="note">{t('financialQuestions.forecast.limitations')}</p>
  </QuestionAnswer>
}
