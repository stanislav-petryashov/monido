import { ProgressTrack } from '../ui/ProgressTrack'
import { useTranslation } from 'react-i18next'
import type { allocationSummary } from '../../domain/spending'
import { fmtCurrencyCents } from '../../lib/formatters'
import { useMoney, usePrivacy } from '../../lib/privacy'
import '../../styles/allocation.css'

const P = 'modules.cashflow.flows.breakdown'

/** A read-only view of the domain allocation summary in the account's `currency`; zero and missing totals never imply completion. */
export function AllocationMeter({ summary, label, currency }: { summary: ReturnType<typeof allocationSummary>; label: string; currency?: string | null }) {
  const { t } = useTranslation()
  const format = useMoney()
  const { hidden } = usePrivacy()
  // to the cent: what is left to split may be cents
  const money = (v: number) => (currency && !hidden ? fmtCurrencyCents(v, currency) : format(v))
  const { total, allocated, rest, over } = summary
  const known = total !== null && Number.isFinite(total)
  const percentage = known && total > 0 && Number.isFinite(allocated) ? allocated / total * 100 : null
  const text = t(`${P}.of`, { allocated: money(allocated), total: known ? money(total) : '—' })
  const note = over.length ? t(`${P}.overTotal`) : !known ? t(`${P}.unknownTotal`) : total === 0 ? t(`${P}.noActivity`) : rest === 0 ? t(`${P}.split`) : t(`${P}.remaining`, { amount: rest === null ? '—' : money(rest) })
  return <div className="allocation-meter">
    <div className="allocation-meter__amount"><strong>{money(allocated)}</strong>{' '}<span>{t(`${P}.ofTotal`, { total: known ? money(total) : '—' })}</span></div>
    {percentage !== null && <ProgressTrack pct={percentage} label={label} valueText={text}
      className={`allocation-meter__track${over.length ? ' allocation-meter__track--over' : ''}`} />}
    <p className={over.length ? 'allocation-meter__note allocation-meter__note--over' : 'allocation-meter__note'}>{note}</p>
  </div>
}
