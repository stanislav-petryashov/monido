import { useTranslation } from 'react-i18next'
import { propertyTotals, securedByMortgage, type PropertyEquity } from '../../../domain/realEstate'
import { fmtPct } from '../../../lib/formatters'
import { useMoney } from '../../../lib/privacy'
import { OwnerAvatar } from '../../../components/ui/OwnerAvatar'
import { useSignedMoney } from './money'
import '../../../styles/assets.css'
import '../../../styles/accounts.css'
import '../../../styles/real-estate.css'

/** A property as the list shows it */
export interface ListProperty {
  name: string
  /** The owner; '' — none */
  member: string
  currency: string
  /** The latest valuation in the property's currency; undefined — none */
  value: number | undefined
  /** Its year; null — none */
  year: number | null
  /** The latest valuation's change against the one before (the first: against the price); null — none */
  change: number | null
  /** Its value in the snapshot's currency there; null — not in the snapshot, or no rate */
  valueBase: number | null
  /** Why its base value is unavailable. */
  missing: 'snapshot' | 'conversion' | null
  /** Its `.asset-tone--*` suffix: the rank by value, as on the Assets map */
  tone: string
  /** Equity and loan-to-value with a linked loan; null — none */
  equity: PropertyEquity | null
}

interface PropertyListProps {
  label: string
  /** Largest first */
  properties: ListProperty[]
  /** The family in its order: the owners' tints */
  members: string[]
  /** The snapshot's currency and assets; null — no snapshot yet */
  base: { currency: string; assets: number | null } | null
  selected: string | null
  onSelect: (name: string) => void
  empty: string
}

/**
 * The Real estate list: «Properties» with their total in the snapshot's currency, a row per property — the owner's
 * avatar, the name, the latest valuation, «owner · currency · valuation <year>», the latest valuation's change and, for
 * a property with a linked loan, «equity · mortgage %» — then the share of the assets with one track segment per
 * property in its Assets tone. Keeps `side-list` / `side-list__item`: the record pane hides and refocuses through them.
 */
export function PropertyList({ label, properties, members, base, selected, onSelect, empty }: PropertyListProps) {
  const { t } = useTranslation()
  const money = useMoney()
  const signedMoney = useSignedMoney()
  const { total, sharePct } = propertyTotals(properties.map(p => p.valueBase), base?.assets ?? null)
  const missingSnapshot = properties.some(p => p.missing === 'snapshot')
  const missingConversion = properties.some(p => p.missing === 'conversion')
  return (
    <div className="side-list acc-list" role="group" aria-label={label}>
      <div className="acc-group__hd">
        <span className="acc-group__title"><i className="asset-map__swatch asset-tone--re" aria-hidden="true" />{label}</span>
        {properties.length > 0 && <span className="num">{total === null || !base ? '—' : money(total, base.currency)}</span>}
      </div>
      {properties.map(p => (
        <button key={p.name} type="button" aria-current={p.name === selected ? 'true' : undefined}
          className="side-list__item record-row record-row--property" onClick={() => onSelect(p.name)}>
          {p.member ? <OwnerAvatar member={p.member} members={members} /> : <span className="lane__avatar holdings__noOwner" aria-hidden="true" />}
          <span className="record-row__name">{p.name}</span>
          <span className="record-row__bal num">{p.value === undefined ? '' : money(p.value, p.currency)}</span>
          <span className="record-row__meta">{[p.member, p.currency, p.year !== null && t('modules.real_estate.valuationOf', { year: p.year })].filter(Boolean).join(' · ')}</span>
          {p.change !== null && p.year !== null && <span className="record-row__chg num">{t('modules.real_estate.changeFor', { change: signedMoney(p.change, p.currency), year: p.year })}</span>}
          {p.equity && base && (
            <span className="re-row__eq">{t('modules.real_estate.equityLine', {
              equity: p.equity.equityBase === null ? '—' : money(p.equity.equityBase, base.currency),
              ltv: fmtPct(p.equity.ltvPct), context: securedByMortgage(p.equity.loans) ? 'mortgage' : undefined,
            })}</span>
          )}
        </button>
      ))}
      {missingSnapshot && <p>{t('modules.real_estate.notInSnapshot')}</p>}
      {missingConversion && <p>{t('modules.real_estate.noConversion')}</p>}
      {properties.length > 0 && base && sharePct === null && total !== null && <p>{t('modules.real_estate.assetsIncomplete')}</p>}
      {properties.length === 0 && <p className="admin-empty">{empty}</p>}
      {base && properties.length > 0 && (
        <div className="re-share">
          <div className="re-share__l">
            <span>{t('modules.real_estate.shareOfAssets')}</span>
            <b className="num">{sharePct === null || base.assets === null ? '—' : t('modules.real_estate.shareOf', { share: fmtPct(sharePct), total: money(base.assets, base.currency) })}</b>
          </div>
          {sharePct !== null && base.assets !== null && base.assets > 0 && <div className="re-track" role="img" aria-label={t('modules.real_estate.shareTrack')}>
            {properties.map(p => (p.valueBase ? <i key={p.name} className={`asset-tone--${p.tone}`} style={{ width: `${(p.valueBase / base.assets!) * 100}%` }} title={p.name} /> : null))}
          </div>}
        </div>
      )}
    </div>
  )
}
