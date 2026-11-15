import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { EquityStep } from '../../../domain/realEstate'
import { fmtDayNumeric, fmtMonth, fmtNum, fmtPct } from '../../../lib/formatters'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../../lib/privacy'
import { WaterfallSvg, type WaterfallStep } from '../../../components/charts/WaterfallSvg'
import { useSignedMoney } from './money'

interface EquityWaterfallProps {
  /** equitySteps of the property: the start, the steps, the end */
  steps: EquityStep[]
  currency: string
  /** The snapshot month, 'YYYY-MM' */
  month: string
  /** Loan-to-value, %; null — unknown */
  ltv: number | null
  /** A phone: short row names */
  compact: boolean
  /** Every linked loan is a mortgage: named so */
  mortgage: boolean
}

/**
 * «How the equity grew»: equity at purchase (a tick) → borrowed later → the value's change (the base real-estate tone) →
 * repaid principal (the lighter tone) → equity now (the primary tick), as the Assets change waterfall draws it.
 */
export function EquityWaterfall({ steps, currency, month, ltv, compact, mortgage }: EquityWaterfallProps) {
  const context = mortgage ? 'mortgage' : undefined
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const money = useMoney()
  const signedMoney = useSignedMoney()
  const titleId = useId()
  const start = steps[0], end = steps[steps.length - 1]
  if (start?.kind !== 'start' || end?.kind !== 'end') return null
  const middle = steps.slice(1, -1)
  const maxChange = Math.max(0, ...middle.map(step => Math.abs(step.amount))) || 1
  const several = middle.filter(s => s.kind === 'repaid').length > 1
  /** The «from» of a name: the number alone, its currency follows with «to» */
  const plain = (v: number) => (hidden ? PRIVACY_MASK : fmtNum(v, 0))
  const path = middle.reduce((run, s) => [...run, run[run.length - 1] + s.amount], [start.amount])
  const rows: WaterfallStep[] = middle.map((s, i) => {
    const name = s.kind === 'borrowed' ? t('modules.real_estate.wf.borrowed', { date: fmtDayNumeric(s.date) })
      : s.kind === 'value' ? (compact ? t('modules.real_estate.wf.valueShort') : t('modules.real_estate.wf.value', { from: plain(s.from), to: money(s.to, currency) }))
      : s.kind === 'repaid' ? (compact ? t('modules.real_estate.wf.repaidShort') : t(several ? 'modules.real_estate.wf.repaidLoan' : 'modules.real_estate.wf.repaid', { loan: s.loan, from: plain(s.from), to: money(s.to, currency), context }))
      : ''
    return { key: `${s.kind}-${i}`, name, from: path[i], to: path[i + 1], tone: s.kind === 'value' ? 're' : s.kind === 'repaid' ? 're-2' : undefined, label: signedMoney(s.amount, currency) }
  })
  const startName = compact ? t('modules.real_estate.wf.startShort')
    : start.noLoan ? t('modules.real_estate.wf.startNoLoan') : t('modules.real_estate.wf.start', { date: fmtDayNumeric(start.date) })
  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('modules.real_estate.wf.title')}</h2>
        <span className="acc-card__meta">{t('modules.real_estate.wf.meta', { start: money(start.amount, currency), end: money(end.amount, currency), ltv: fmtPct(ltv), context })}</span>
      </div>
      {compact ? <div className="equity-breakdown">
        <div className="equity-breakdown__total"><span>{startName}</span><span className="num">{money(start.amount, currency)}</span></div>
        <ul className="equity-breakdown__steps">
          {rows.map((row, i) => <li className="equity-breakdown__step" key={row.key}>
            <span className="equity-breakdown__name">{row.name}</span>
            <div className="equity-breakdown__track" aria-hidden="true"><i className={row.tone ? `asset-tone--${row.tone}` : undefined} style={{ width: `${Math.abs(middle[i].amount) / maxChange * 100}%` }} /></div>
            <span className="num">{row.label}</span>
          </li>)}
        </ul>
        <div className="equity-breakdown__total equity-breakdown__total--end"><span>{t('modules.real_estate.wf.endShort')}</span><span className="num">{money(end.amount, currency)}</span></div>
      </div> : <WaterfallSvg lane={280}
        label={t('modules.real_estate.wf.label', { start: money(start.amount, currency), end: money(end.amount, currency) })}
        start={{ name: startName, value: start.amount, label: money(start.amount, currency) }}
        steps={rows}
        end={{ name: compact ? t('modules.real_estate.wf.endShort') : t('modules.real_estate.wf.end', { month: fmtMonth(month) }), value: end.amount, label: money(end.amount, currency) }} />}
    </section>
  )
}
