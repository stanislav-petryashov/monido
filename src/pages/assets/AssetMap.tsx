import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../components/ui/Link'
import type { HoldingChange } from '../../domain/assetChanges'
import { fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { holdingKey, holdingTones, TONES } from './tones'

type MapType = keyof typeof TONES
/** Under this share of the assets a tile shows only its share */
const TINY = 0.04

interface AssetMapProps {
  /** At the period's end, or the current capital's with no period */
  holdings: HoldingChange[]
  /** The assets the shares are of: the headline's total */
  total: number
  totalKnown?: boolean
  scopeKnown?: boolean
  recordOf: (h: HoldingChange) => string | null
  fmt: (v: number) => string
  /** «over the month»: the period of the tiles' changes; null — no period, no change captions */
  overLabel: string | null
}

const flex = (value: number) => ({ flex: `${value} 1 0` })
const sum = (hs: HoldingChange[]) => hs.reduce((a, h) => a + h.valueBase, 0)

/**
 * The assets as areas: real estate in its own column, the accounts in the second — brokerage stacked above the bank
 * accounts side by side, then the other holdings side by side. Each tile is its holding's value, a link to its record.
 */
export function AssetMap({ holdings, total, totalKnown = true, scopeKnown = true, recordOf, fmt, overLabel }: AssetMapProps) {
  const { t } = useTranslation()
  const descriptionId = useId()
  const mapRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map) return
    let active = true
    const measure = () => {
      if (!active) return
      map.querySelectorAll<HTMLElement>('.asset-tile').forEach(tile => {
        const content = tile.querySelector<HTMLElement>('.asset-tile__content')
        if (content) tile.dataset.clipped = String(content.scrollWidth > content.clientWidth || content.scrollHeight > content.clientHeight)
      })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    map.querySelectorAll('.asset-tile').forEach(tile => observer?.observe(tile))
    measure()
    void document.fonts?.ready.then(measure)
    return () => { active = false; observer?.disconnect() }
  }, [holdings, fmt, overLabel])
  const of = (type: MapType) => holdings.filter(h => h.type === type && h.valueKnown && h.valueBase > 0).sort((a, b) => b.valueBase - a.valueBase)
  const re = of('real_estate'), br = of('broker'), bk = of('bank'), ot = of('other')
  const toneOf = holdingTones(holdings)

  const tile = (h: HoldingChange) => {
    const share = total ? h.valueBase / total : 0
    const tiny = share < TINY
    const pct = totalKnown ? fmtPct(share * 100) : '—'
    const change = overLabel === null || !h.changeKnown ? null : `${signed(h.change, fmt)} ${overLabel}`
    const label = `${h.member ? `${h.name} · ${h.member}` : h.name}: ${fmt(h.valueBase)}${change ? `, ${change}` : ''}`
    const props = {
      className: `asset-tile asset-tone--${toneOf(h)}${tiny ? ' asset-tile--tiny' : ''}`,
      style: flex(h.valueBase),
      title: label,
      'aria-label': label,
    }
    const body: ReactNode = tiny ? <span className="asset-tile__v">{pct}</span> : (
      <>
        <b>{h.name}</b>
        <span className="asset-tile__v">{`${pct} · ${fmt(h.valueBase)}`}</span>
        {(h.member || change) && <span className="asset-tile__c">{[h.member, change].filter(Boolean).join(' · ')}</span>}
      </>
    )
    const to = recordOf(h)
    const key = holdingKey(h)
    return to ? <Link key={key} to={to} {...props}><span className="asset-tile__content">{body}</span></Link> : <span key={key} {...props}><span className="asset-tile__content">{body}</span></span>
  }

  const types = ([['real_estate', re], ['broker', br], ['bank', bk], ['other', ot]] as const).filter(([, hs]) => hs.length > 0)
  return (
    <div>
      <div ref={mapRef} className="asset-map" role="group" aria-label={t('pages.assets.mapLabel')} aria-describedby={descriptionId}>
        {re.length > 0 && <div className="asset-map__col" style={flex(sum(re))}>{re.map(tile)}</div>}
        {br.length + bk.length + ot.length > 0 && (
          <div className="asset-map__col" style={flex(sum(br) + sum(bk) + sum(ot))}>
            {br.length > 0 && <div className="asset-map__col" style={flex(sum(br))}>{br.map(tile)}</div>}
            {bk.length > 0 && <div className="asset-map__row" style={flex(sum(bk))}>{bk.map(tile)}</div>}
            {ot.length > 0 && <div className="asset-map__row" style={flex(sum(ot))}>{ot.map(tile)}</div>}
          </div>
        )}
      </div>
      <div className="asset-map__key">
        {types.map(([type, hs]) => (
          <span key={type}>
            <i className={`asset-map__swatch asset-tone--${TONES[type][0]}`} />
            {t(`pages.assets.type.${type}`)} <b className="num">{scopeKnown && holdings.filter(h => h.type === type && !h.closed).every(h => h.valueKnown) ? fmt(sum(hs)) : '—'}</b>
          </span>
        ))}
      </div>
      <p id={descriptionId} className="assets-meta">{t('pages.assets.mapScope')}</p>
    </div>
  )
}
