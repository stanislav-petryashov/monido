import { useTranslation } from 'react-i18next'
import type { Zone } from '../../domain/types'
import { zoneTitle } from '../../lib/metricText'

const ORDER: Zone[] = ['red', 'amber', 'green', 'excellent']

interface ZoneBarProps {
  zone: Zone | null
  /** Thresholds [a, b, c] from zoneThresholds() */
  thresholds: readonly [number, number, number]
  /** «Less is better»: the bad zone is above threshold c */
  inverse: boolean
  /** Label suffix: '%', ' mo', '×' */
  unit: string
}

/** Four zones from «bad» to «excellent» with threshold labels; the current one is filled. */
export function ZoneBar({ zone, thresholds: [a, b, c], inverse, unit }: ZoneBarProps) {
  const { t } = useTranslation()
  const labelsWith = (end: string) => inverse
    ? [`≥ ${c}${end}`, `${b}–${c}`, `${a}–${b}`, `< ${a}${end}`]
    : [`≤ ${a}${end}`, `${a}–${b}`, `${b}–${c}`, `> ${c}${end}`]
  // a word (" mo of income") does not fit a quarter of a card and the value above names it; a sign does
  const labels = labelsWith(unit.startsWith(' ') ? '' : unit)
  const thresholdText = labelsWith(unit).join(', ')
  const name = zone ? t('cards.zone.known', { zone: zoneTitle(zone), thresholds: thresholdText }) : t('cards.zone.unknown', { thresholds: thresholdText })
  return (
    <div className="zones" role="img" aria-label={name}>
      {ORDER.map((z, i) => (
        <div key={z} className="zones__col">
          <div className={z === zone ? `zones__seg zones__seg--on zones__seg--${z}` : 'zones__seg'} />
          <span className="zones__label">{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}
