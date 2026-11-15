import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { FinanceSnapshot } from '../../domain/types'
import { useDisplayCurrency } from '../../lib/currencyState'
import { SNAPSHOT_KEY_ROOT, useSnapshot } from '../../lib/useFinanceData'
import { RadioMenu } from '../ui/RadioMenu'
import { SegmentedPills } from '../ui/SegmentedPills'

/** Up to this many currencies fit as pills; more open a menu. */
const MAX_PILLS = 4

/**
 * Quick view of the dashboard in another currency, for this tab: the project's currencies, the shown one first, the
 * family currency marked; pills for a few, a menu for many. Choosing the family currency clears the view.
 */
export function CurrencySwitch() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const { view, setView } = useDisplayCurrency()
  const { data: current } = useSnapshot()
  // while the snapshot of a newly chosen view loads, the switch keeps what an earlier one told it: it must not vanish
  const known = current ?? client.getQueriesData<FinanceSnapshot>({ queryKey: SNAPSHOT_KEY_ROOT }).find(([, s]) => s)?.[1]
  const family = known?.familyCurrency
  // a stable order: the family currency first, then the project's others; the choice only moves the pressed state
  const items = family ? [family, ...known.currencies.filter(c => c !== family)] : []
  const shown = view ?? family ?? ''
  const label = t('common.currency')
  const caption = (code: string) => (code === family ? t('common.familyCurrency', { code }) : code)
  const choose = (code: string) => setView(code === family ? null : code)
  const control = items.length <= MAX_PILLS
    ? <SegmentedPills ariaLabel={label} items={items} active={shown} onSelect={choose} label={caption} />
    : <RadioMenu value={shown} options={items.map(c => ({ value: c, label: caption(c) }))} onChange={choose} label={label} triggerText={shown} />
  // the control keeps its own accessible name, so the caption is not announced twice
  return (
    <div className="currency-switch">
      <span className="currency-switch__caption" aria-hidden="true">{t('common.showIn')}</span>
      {control}
    </div>
  )
}
