import { RecordKpis } from '../../../components/cards/RecordKpis'
import { useTranslation } from 'react-i18next'
import { securedByMortgage, type PropertyEquity, type PropertyGain, type Valuation } from '../../../domain/realEstate'
import { fmtDayNumeric, fmtPct } from '../../../lib/formatters'
import { useMoney } from '../../../lib/privacy'
import { useSignedMoney } from './money'

interface PropertyKpisProps {
  latest: Valuation
  purchase: { price: number; date: string; currency: string }
  gain: PropertyGain | null
  /** The snapshot's side: the property's base value and share, its currency, assets and date; null — no snapshot */
  base: { valueBase: number | null; share: number | null; currency: string; assets: number | null; date: string } | null
  /** With a linked loan: equity and loan-to-value; null — none */
  equity: PropertyEquity | null
  /** The link to the loan on Loans (its first linked loan) */
  loanHref: string | null
}

/**
 * The KPI strip under the property's head — the value (a foreign one also in the snapshot's currency at its rate), the
 * change since purchase with % of the price, the average per year, the share of the assets — and, with a linked loan,
 * the equity row: equity, loan-to-value with the loan as a link, and what the value is made of (equity and loan).
 */
export function PropertyKpis({ latest, purchase, gain, base, equity, loanHref }: PropertyKpisProps) {
  const { t } = useTranslation()
  const money = useMoney()
  const signedMoney = useSignedMoney()
  const foreign = base !== null && base.valueBase !== null && base.currency !== latest.currency
  const bought = Number(purchase.date.slice(0, 4))
  const cells = [
    {
      key: 'value', label: t('modules.real_estate.kpi.value'), value: money(latest.value, latest.currency),
      meta: foreign ? t('modules.real_estate.kpi.atRate', { amount: money(base.valueBase!, base.currency), date: fmtDayNumeric(base.date) })
        : base ? t('modules.real_estate.kpi.valuationOn', { year: latest.year, date: fmtDayNumeric(base.date) }) : t('modules.real_estate.kpi.valuation', { year: latest.year }),
    },
    ...(gain ? [{
      key: 'gain', label: t('modules.real_estate.kpi.since'), value: signedMoney(gain.amount, gain.currency),
      meta: gain.percent === null ? null : t('modules.real_estate.kpi.ofPrice', { pct: fmtPct(gain.percent, { sign: true }), price: money(purchase.price, purchase.currency) }),
    }] : []),
    ...(gain?.perYear != null ? [{
      key: 'year', label: t('modules.real_estate.kpi.perYear'), value: signedMoney(gain.perYear, gain.currency),
      meta: t('modules.real_estate.kpi.overYears', { count: latest.year - bought, from: bought, to: latest.year }),
    }] : []),
    {
      key: 'share', label: t('modules.real_estate.kpi.share'), value: base?.share != null ? fmtPct(base.share) : '—',
      meta: base && base.assets !== null && base.assets > 0 ? t('modules.real_estate.kpi.ofAssets', { total: money(base.assets, base.currency) }) : null,
    },
  ]
  const ltv = equity?.ltvPct ?? null
  const loan = equity?.loans[0]
  /** «Mortgage» when every linked loan is one, else «Loan» */
  const context = equity && securedByMortgage(equity.loans) ? 'mortgage' : undefined
  return (
    <>
      <RecordKpis label={t('modules.real_estate.kpi.figures')} cells={cells} />
      {equity && base && loan && (
        <dl className="acc-kpis re-eq" aria-label={t('modules.real_estate.eq.figures')}>
          <div className="acc-kpi">
            <dt className="acc-kpi__l">{t('modules.real_estate.eq.equity')}</dt>
            <dd className="acc-kpi__v num">{equity.equityBase === null ? '—' : money(equity.equityBase, base.currency)}</dd>
            <dd className="acc-kpi__m">{t('modules.real_estate.eq.equityMeta', { date: fmtDayNumeric(base.date), context })}</dd>
          </div>
          <div className="acc-kpi">
            <dt className="acc-kpi__l">{t('modules.real_estate.eq.ltv', { context })}</dt>
            <dd className="acc-kpi__v num">{ltv === null ? '—' : fmtPct(ltv)}</dd>
            <dd className="acc-kpi__m">
              {loanHref ? <a className="link-accent" href={loanHref}>{equity.loans.map(l => l.name).join(', ')}</a> : equity.loans.map(l => l.name).join(', ')}
              {equity.debtBase !== null && ` · ${money(equity.debtBase, base.currency)}`}
            </dd>
          </div>
          {ltv !== null && equity.valueBase !== null && (
            <div className="acc-kpi re-eq__bar">
              <dt className="acc-kpi__l">{t('modules.real_estate.eq.madeOf', { value: money(equity.valueBase, base.currency) })}</dt>
              <dd className="re-track re-track--tall" role="img" aria-label={t('modules.real_estate.eq.barLabel', { equity: fmtPct(100 - ltv), loan: fmtPct(ltv), context })}>
                <i className="asset-tone--re" style={{ width: `${Math.max(0, 100 - ltv)}%` }} />
                <i className="re-debt" style={{ width: `${Math.min(100, ltv)}%` }} />
              </dd>
              <dd className="acc-kpi__m re-eq__key">
                <span><i className="asset-map__swatch asset-tone--re" aria-hidden="true" />{t('modules.real_estate.eq.equityShare', { pct: fmtPct(100 - ltv) })}</span>
                <span><i className="asset-map__swatch re-debt" aria-hidden="true" />{t('modules.real_estate.eq.loanShare', { pct: fmtPct(ltv), context })}</span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </>
  )
}
