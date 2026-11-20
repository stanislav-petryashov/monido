import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { availabilityParts, confirmationProgress } from '../../../domain/availability'
import { fmtMonth, fmtMonths, fmtPct } from '../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../lib/privacy'
import { RecordKpis } from '../../cards/RecordKpis'
import { FlowBar } from './FlowBar'

interface AvailabilityHeroProps {
  month: string
  baseCurrency: string
  parts: ReturnType<typeof availabilityParts>
  progress: ReturnType<typeof confirmationProgress>
  /** The family's usual monthly expenses (`reserveSpendingBaseline`); null — not known */
  perMonth: number | null
  /** The cushion's goal in months (the health module's emergency-fund target) */
  goalMonths: number
  /** Why the total waits although every account is confirmed; null — it does not */
  blockedNote: string | null
  /** Opens the first unconfirmed account; undefined — a viewer, or nothing to confirm */
  onConfirm?: () => void
  /** An editor is open: the page's one primary action is there */
  editing: boolean
  /** The why-line links (the goals and health modules), keyed by part */
  links: Partial<Record<'reserve' | 'goals', ReactNode>>
  money: (value: number, currency?: string) => string
}

/** The free amount first: confirmed — it, its months of usual expenses, the cushion and the money available at once beside where the money sits; waiting — a dash, the progress and the one way forward. */
export function AvailabilityHero({ month, baseCurrency, parts, progress, perMonth, goalMonths, blockedNote, onConfirm, editing, links, money }: AvailabilityHeroProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const label = <div className="figure-label">{t('availability.freeLabel', { month: fmtMonth(month) })}</div>
  const masked = (text: string) => hidden ? PRIVACY_MASK : text
  if (!parts) {
    return <section className="card card--p avail-hero" aria-label={t('availability.heroLabel')}>
      <div>
        {label}
        <div className="avail-hero__big">—</div>
        <p className="avail-hero__lead">{t('availability.waitLead', { count: progress.total, confirmed: progress.confirmed })}</p>
        {blockedNote && <p className="avail-hero__lead" role="status">{blockedNote}</p>}
      </div>
      <div className="avail-wait">
        <div className="card-hd">{t('availability.waitTitle')}</div>
        <div className="avail-wait__segs" aria-hidden="true">{progress.accounts.map(({ account, confirmed }) => <i key={`${account.name}\u0000${account.member}`} className={confirmed ? 'is-on' : undefined} />)}</div>
        <p className="avail-hero__lead">{t('availability.waitHow')}</p>
        {onConfirm && progress.waiting.length > 0 && <div><button type="button" className={`btn ${editing ? 'btn--ghost' : 'btn--primary'}`} onClick={onConfirm}>
          {t('availability.confirmAll', { month: t(`dates.month.${Number(month.slice(5, 7))}`), count: progress.waiting.length })}
        </button></div>}
      </div>
    </section>
  }
  const reserve = parts.parts.find(p => p.key === 'reserve')!.amount
  const free = parts.parts.find(p => p.key === 'free')!.amount
  const reserveMeta = [perMonth !== null && t('availability.reserveMonths', { months: masked(fmtMonths(reserve / perMonth)) }), t('availability.reserveGoal', { months: fmtMonths(goalMonths) })].filter(Boolean).join(' · ')
  return <section className="card card--p avail-hero" aria-label={t('availability.heroLabel')}>
    <div>
      {label}
      <div className="avail-hero__big num">{money(free, baseCurrency)}</div>
      <p className="avail-hero__lead">{perMonth === null || hidden ? t('availability.freeLead') : t('availability.freeLeadMonths', { months: fmtMonths(free / perMonth) })}</p>
      {perMonth === null && <p className="note">{t('availability.noCoverage')}</p>}
      <RecordKpis className="avail-mini" cells={[
        { key: 'reserve', label: t('availability.reserve'), value: money(reserve, baseCurrency), meta: reserveMeta || null },
        { key: 'available', label: t('availability.available'), value: money(parts.available, baseCurrency), meta: t('availability.availableShare', { share: masked(fmtPct(parts.availableShare)) }) },
      ]} />
    </div>
    <FlowBar parts={parts} baseCurrency={baseCurrency} links={links} money={money} />
  </section>
}
