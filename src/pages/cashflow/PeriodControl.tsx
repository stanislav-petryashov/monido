import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { shiftMonth } from '../../domain/dates'
import type { AssetPeriod } from '../../domain/types'
import { SegmentedPills } from '../../components/ui/SegmentedPills'
import { fmtMonth } from '../../lib/formatters'
import { ASSET_PERIODS } from '../../domain/types'
import { periodLabel } from './text'

interface PeriodControlProps {
  kind: AssetPeriod
  end: string
  /** The period's months, oldest first */
  months: string[]
  /** Every month with flows, oldest first */
  all: string[]
  /** The last closed month: "›" stops there */
  last: string
  onKind: (kind: AssetPeriod) => void
  onMonth: (month: string) => void
}

/**
 * The page's one period: Month / Quarter / Year / All time and "‹ month ›" stepping the period's last month through the
 * months with flows; "›" is disabled at the last closed month (its title names the open one). All time has no steps.
 */
export function PeriodControl({ kind, end, months, all, last, onKind, onMonth }: PeriodControlProps) {
  const { t } = useTranslation()
  const i = all.indexOf(end)
  return (
    <div className="cf-period">
      <SegmentedPills overflow="scroll" ariaLabel={t('cashflowPage.period.group')} items={ASSET_PERIODS} active={kind} onSelect={onKind} label={p => t(`cashflowPage.period.${p}`)} />
      {kind === 'all' ? <span className="cf-period__range">{periodLabel(t, months)}</span> : (
        <div className="cf-period__step">
          <button type="button" className="icon-btn" aria-label={t('cashflowPage.period.earlier')} disabled={i <= 0} onClick={() => onMonth(all[i - 1])}>
            <IconChevronLeft size={18} stroke={2} aria-hidden="true" />
          </button>
          <span className="cf-period__range" aria-live="polite">{periodLabel(t, months)}</span>
          <button type="button" className="icon-btn" aria-label={t('cashflowPage.period.later')} disabled={end >= last}
            title={end >= last ? t('cashflowPage.period.notClosed', { month: fmtMonth(shiftMonth(last, 1)) }) : undefined} onClick={() => onMonth(all[i + 1])}>
            <IconChevronRight size={18} stroke={2} aria-hidden="true" />
          </button>
        </div>
      )}
      <span className="cf-period__hint">{t('cashflowPage.period.hint')}</span>
    </div>
  )
}
