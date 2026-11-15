import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { availabilityParts } from '../../../domain/availability'
import { classLabel, fmtPct } from '../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../lib/privacy'

type Parts = NonNullable<ReturnType<typeof availabilityParts>>

/** Each name once, in order: two members may hold an account of one name */
const unique = (names: string[]) => [...new Set(names)].join(', ')

/**
 * Where the money on the accounts sits: one bar of the five parts (not available at once hatched, the earmarks in the
 * bank blues, free in the primary), then the legend — swatch, name, why-line naming the accounts, amount, share.
 * In privacy mode the bar is not drawn: its proportions are amounts too.
 */
export function FlowBar({ parts, baseCurrency, links, money }: { parts: Parts; baseCurrency: string; links: Partial<Record<'reserve' | 'goals', ReactNode>>; money: (value: number, currency?: string) => string }) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const why = (part: Parts['parts'][number]) => {
    if (part.key === 'free' || part.accounts.length === 0) return null
    const text = part.key === 'unavailable'
      ? t('availability.whyUnavailable', { types: unique(part.accounts.map(a => classLabel(a.class))) })
      : t('availability.whyHolders', { accounts: unique(part.accounts.map(a => a.name)) })
    const link = part.key === 'reserve' || part.key === 'goals' ? links[part.key] : null
    return <span className="avail-legend__why">{text}{link && <> · {link}</>}</span>
  }
  return <div className="avail-flow">
    <div className="avail-flow__head">
      <h2 className="card-hd">{t('availability.flowTitle')}</h2>
      <span className="avail-flow__meta">{t('availability.flowTotal', { amount: money(parts.total, baseCurrency) })}</span>
    </div>
    {hidden ? <div className="avail-flow__bar avail-flow__bar--masked" aria-hidden="true" /> : (
      <div className="avail-flow__bar" role="img" aria-label={t('availability.flowLabel', { parts: parts.parts.filter(p => p.amount > 0).map(p => `${t(`availability.${p.key}`)} ${money(p.amount, baseCurrency)}`).join(', ') })}>
        {parts.parts.filter(p => p.amount > 0).map(p => <i key={p.key} data-part={p.key} className={`avail-part--${p.key}`} style={{ flexGrow: p.amount }} />)}
      </div>
    )}
    <table className="avail-legend" role="table">
      <tbody role="rowgroup">
        {parts.parts.map(p => <tr role="row" key={p.key} className={p.key === 'free' ? 'avail-legend__free' : undefined}>
          <td role="cell"><span className="avail-legend__name"><i className={`avail-swatch avail-part--${p.key}`} aria-hidden="true" />{t(`availability.${p.key}`)}</span>{why(p)}</td>
          <td role="cell" className="num">{money(p.amount, baseCurrency)}</td>
          <td role="cell" className="num avail-legend__share">{hidden ? PRIVACY_MASK : fmtPct(p.share, { digits: 0, preserveNonzero: true })}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
