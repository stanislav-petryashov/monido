import { useTranslation } from 'react-i18next'
import { Link } from '../../components/ui/Link'
import type { HoldingChange } from '../../domain/assetChanges'
import { round2 } from '../../domain/fx'
import { fmtMoney, fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { holdingKey, TONES, TYPES } from './tones'

interface HoldingsListProps {
  /** At the period's end, or the current capital's with no period */
  holdings: HoldingChange[]
  /** The assets the shares are of: the headline's total */
  total: number
  totalKnown?: boolean
  scopeKnown?: boolean
  changeScopeKnown?: boolean
  recordOf: (h: HoldingChange) => string | null
  fmt: (v: number) => string
  members: string[]
  /** The snapshot's currency: a holding in another one shows its own amount too */
  baseCurrency: string
  /** «over the month»: the period of the changes; null — no period, no change column */
  overLabel: string | null
}

const sum = (hs: HoldingChange[], pick: (h: HoldingChange) => number) => round2(hs.reduce((a, h) => a + pick(h), 0))

/**
 * Each holding, grouped by type (real estate, brokerage, bank, other): the group's count, subtotal with its share and
 * change over a rule in its colour; a row per holding — the owner's avatar, the name as a link to its record, the owner
 * and the own-currency amount, the value with its share, the change with its % of the start or why it is what it is.
 */
export function HoldingsList({ holdings, total, totalKnown = true, scopeKnown = true, changeScopeKnown = scopeKnown, recordOf, fmt, members, baseCurrency, overLabel }: HoldingsListProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  // a holding without a rate stays listed, its value and change unknown (the warnings above the page name it)
  const shown = holdings
  const max = Math.max(0, ...shown.map(h => h.valueBase))
  const share = (v: number) => fmtPct(total ? (v / total) * 100 : 0)
  const change = (c: number) => <span>{signed(c, fmt)}</span>
  const note = (h: HoldingChange) => {
    if (h.missingEnd) return t('pages.assets.incomplete')
    if (h.noRate) return t('pages.assets.noRate')
    if (h.startNoRate) return t('pages.assets.startNoRate')
    if (h.closed) return t('pages.assets.closed')
    if (!h.changeKnown) return t('pages.assets.comparisonUnavailable')
    if (h.opened) return t('pages.assets.opened')
    if (h.currencyOnly) return t('pages.assets.fxOnly', { currency: h.currency })
    if (h.change === 0) return t('pages.assets.noChange')
    return h.changePct === null ? '' : fmtPct(h.changePct, { sign: true })
  }

  return (
    <section className="card card--p mt-2" aria-labelledby="assets-holdings">
      <div className="card-hd--row">
        <h2 className="card-hd" id="assets-holdings" tabIndex={-1}>{t('pages.assets.holdingsTitle')}</h2>
        <span className="assets-meta">{scopeKnown && shown.every(h => !h.missingEnd) ? t('pages.assets.holdings', { count: shown.filter(h => !h.closed).length }) : '—'}</span>
      </div>
      <div className={overLabel === null ? 'holdings__cols holdings--still' : 'holdings__cols'} aria-hidden="true">
        <span>{t('pages.assets.cols.holding')}</span>
        <span>{t('pages.assets.cols.value')}</span>
        {overLabel !== null && <span>{t('pages.assets.cols.change', { period: overLabel })}</span>}
      </div>
      {TYPES.map(type => {
        const rows = shown.filter(h => h.type === type).sort((a, b) => b.valueBase - a.valueBase)
        if (rows.length === 0) return null
        const subtotal = sum(rows, h => h.valueBase)
        return (
          <div key={type} className={`holdings__group asset-tone--${TONES[type][0]}`}>
            <div className={overLabel === null ? 'holdings__head holdings--still' : 'holdings__head'}>
              <h3>
                <i className={`asset-map__swatch asset-tone--${TONES[type][0]}`} />
                {t(`pages.assets.type.${type}`)}
                <span className="holdings__dim">{` · ${scopeKnown && rows.every(h => !h.missingEnd) ? rows.filter(h => !h.closed).length : '—'}`}</span>
              </h3>
              <span className="holdings__n num">{scopeKnown && rows.every(h => h.valueKnown) ? fmt(subtotal) : '—'} <span className="holdings__dim">{totalKnown && scopeKnown && rows.every(h => h.valueKnown) ? share(subtotal) : '—'}</span></span>
              {overLabel !== null && <span className="holdings__n num">{changeScopeKnown && rows.every(h => h.changeKnown) ? change(sum(rows, h => h.change)) : '—'}</span>}
            </div>
            <ul>
              {rows.map(h => {
                const to = recordOf(h)
                const own = h.currency !== baseCurrency && !h.closed && !h.missingEnd ? `${hidden ? PRIVACY_MASK : fmtMoney(h.value)} ${h.currency}` : null
                const meta = [h.member, own].filter(Boolean).join(' · ')
                return (
                  <li key={holdingKey(h)} className={overLabel === null ? 'holdings__row holdings--still' : 'holdings__row'}>
                    <div className="holdings__who">
                      {/* no owner: a blank in the avatar's place keeps the names in one column */}
                      {h.member ? <OwnerAvatar member={h.member} members={members} /> : <span className="lane__avatar holdings__noOwner" aria-hidden="true" />}
                      <div>
                        {to ? <Link to={to} className="holdings__name">{h.name}</Link> : <span className="holdings__name">{h.name}</span>}
                        {meta && <div className="holdings__meta">{meta}</div>}
                      </div>
                    </div>
                    <div className="holdings__val num">
                      {h.valueKnown ? fmt(h.valueBase) : '—'}
                      {h.valueKnown && (
                        <>
                          <small>{totalKnown ? t('pages.assets.shareOf', { share: share(h.valueBase) }) : '—'}</small>
                          <div className="holdings__bar" aria-hidden="true"><i style={{ width: `${max ? (h.valueBase / max) * 100 : 0}%` }} /></div>
                        </>
                      )}
                    </div>
                    {overLabel !== null && (
                      <div className="holdings__chg num">
                        {h.changeKnown ? change(h.change) : <span>—</span>}
                        <small>{note(h)}</small>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
