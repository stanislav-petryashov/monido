import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { round2 } from '../../../domain/fx'
import { fmtMonthYear } from '../../../lib/formatters'
import { signed } from '../../../lib/pageHelpers'
import { useMoney } from '../../../lib/privacy'
import { OwnerAvatar } from '../../../components/ui/OwnerAvatar'
import { TONES } from '../../assets/tones'
import '../../../styles/assets.css'
import '../../../styles/accounts.css'
import { LIST_TYPES, listOrder, listType, ownersOf, type ListAccount } from './listOrder'

interface OwnerChipsProps {
  accounts: ListAccount[]
  members: string[]
  /** The owner shown; null — everyone */
  who: string | null
  onChange: (who: string | null) => void
}

/** The list's owner filter: «All · N», then each owner with the avatar and the count; drawn above the search in the list. */
export function OwnerChips({ accounts, members, who, onChange }: OwnerChipsProps) {
  const { t } = useTranslation()
  return (
    <div className="acc-who" role="group" aria-label={t('data.accounts.ownerFilter')}>
      <button type="button" className="acc-who__chip" aria-pressed={who === null} onClick={() => onChange(null)}>
        {t('data.accounts.allCount', { count: accounts.length })}
      </button>
      {ownersOf(accounts, members).map(m => (
        <button key={m} type="button" className="acc-who__chip" aria-pressed={who === m} onClick={() => onChange(m)}>
          {m && <OwnerAvatar member={m} members={members} />}
          {t('data.accounts.ownerCount', { name: m || t('data.accounts.noOwner'), count: accounts.filter(a => a.acc.member === m).length })}
        </button>
      ))}
    </div>
  )
}

interface AccountListProps {
  ownerFilter?: ReactNode
  label: string
  accounts: ListAccount[]
  /** The family in its order: the owners' tints */
  members: string[]
  baseCurrency: string | null
  /** The owner chips' choice; null — everyone */
  who: string | null
  selected: string | null
  onSelect: (key: string) => void
  empty: string
  query: string
  onQuery: (query: string) => void
}

/**
 * The accounts screen's list: the groups by type, each with its tone and its subtotal in the snapshot's currency (an
 * account without a rate is named, not counted as 0); a row — the owner's avatar, the name, the last closed month's
 * balance in its currency, «owner · currency», the month's change. Keeps `side-list` / `side-list__item`: the record
 * pane hides and refocuses through them.
 */
export function AccountList({ label, accounts, members, baseCurrency, who, selected, onSelect, empty, query, onQuery, ownerFilter }: AccountListProps) {
  const { t } = useTranslation()
  const money = useMoney()
  const shown = listOrder(accounts).filter(a => who === null || a.acc.member === who)

  const row = (a: ListAccount) => (
    <button key={a.key} type="button" aria-current={a.key === selected ? 'true' : undefined}
      className="side-list__item record-row record-row--account" onClick={() => onSelect(a.key)}>
      {/* no owner: a blank in the avatar's place keeps the names in one column */}
      {a.acc.member ? <OwnerAvatar member={a.acc.member} members={members} /> : <span className="lane__avatar holdings__noOwner" aria-hidden="true" />}
      <span className="record-row__name">{a.acc.bank}</span>
      <span className="record-row__bal num">{a.balance === undefined ? '' : money(a.balance, a.acc.currency)}</span>
      <span className="record-row__meta">{[a.acc.member, a.acc.currency, a.olderMonth && t('data.accounts.onMonth', { month: fmtMonthYear(a.olderMonth) })].filter(Boolean).join(' · ')}</span>
      {a.change !== null && (
        <span className="record-row__chg num">
          {t('data.accounts.overMonth', { change: signed(a.change, v => money(v, a.acc.currency)) })}
        </span>
      )}
    </button>
  )

  return (
    <div className="side-list acc-list" role="group" aria-label={label}>
      {ownerFilter}
      <label className="acc-search">{t('data.accounts.search')}<input className="admin-input" type="search" value={query} onChange={e => onQuery(e.target.value)} /></label>
      {LIST_TYPES.map(type => {
        const rows = shown.filter(a => listType(a.acc) === type)
        if (rows.length === 0) return null
        // an older balance is not of the subtotal's month: left out, and said so
        const subtotal = round2(rows.reduce((s, a) => s + (a.olderMonth ? 0 : a.valueBase ?? 0), 0))
        const noRate = rows.filter(a => a.noRate).length
        const older = rows.filter(a => a.olderMonth).length
        return (
          <div key={type} className="acc-group">
            <div className="acc-group__hd">
              <span className="acc-group__title"><i className={`asset-map__swatch asset-tone--${TONES[type][0]}`} aria-hidden="true" />{t(`pages.assets.type.${type}`)}</span>
              {baseCurrency && <span className="num">{money(subtotal, baseCurrency)}{query.trim() && ` · ${t('data.accounts.filtered')}`}{noRate > 0 && ` · ${t('pages.accounts.noRate', { count: noRate })}`}{older > 0 && ` · ${t('data.accounts.olderBalance', { count: older })}`}</span>}
            </div>
            {rows.map(row)}
          </div>
        )
      })}
      {shown.length === 0 && <p className="empty">{empty}</p>}
    </div>
  )
}
