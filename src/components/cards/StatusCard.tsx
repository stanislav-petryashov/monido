import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MetricKey } from '../../domain/metricCatalog'
import type { Zone } from '../../domain/types'
import { Chip } from '../ui/Chip'
import { Link } from '../ui/Link'
import { CopyPromptButton } from '../../modules/claude-prompts/CopyPromptButton'
import type { SemanticColor } from '../ui/types'
import { zoneTitle } from '../../lib/metricText'
import { StatRow } from './StatRow'
import { ZoneBar } from './ZoneBar'
import { DisclosureChevron } from '../ui/DisclosureChevron'

const ZONE_COLOR: Record<Zone, SemanticColor> = { red: 'error', amber: 'warning', green: 'success', excellent: 'success' }

export interface StatusCardProps {
  label: string
  /** Text, or text with a smaller unit part (`.status__unit`) */
  value: ReactNode
  /** null — the metric could not be computed */
  zone: Zone | null
  thresholds: readonly [number, number, number]
  inverse: boolean
  unit: string
  advice?: string
  promptKey?: MetricKey
  /** The address anchor: `/page#id` leads to this card */
  id?: string
  /** The address names this card: it takes the focus and is outlined */
  target?: boolean
  /** The same metric over other windows, under the value */
  rows?: readonly { label: string; value: string }[]
  /** The page that owns the metric's trend and detail */
  link?: { to: string; label: string }
  /** Why the value is missing and where to fix it, under the advice */
  note?: ReactNode
}

/** A health zone as a status chip; without a zone — «No data». The children replace the zone's name. */
export function ZoneChip({ zone, children }: { zone: Zone | null; children?: ReactNode }) {
  const { t } = useTranslation()
  return <Chip color={zone ? ZONE_COLOR[zone] : 'secondary'}>{children ?? (zone ? zoneTitle(zone) : t('common.noData'))}</Chip>
}

/** A metric's value and assessment stay visible; its explanation opens in place. */
export function StatusCard({ label, value, zone, thresholds, inverse, unit, advice, promptKey, id, target, rows, link, note }: StatusCardProps) {
  const { t } = useTranslation()
  const color = zone ? ZONE_COLOR[zone] : 'secondary'
  return <details className="card card--p status status-compact" id={id} tabIndex={target ? -1 : undefined} open={target || zone === 'red' || zone === 'amber' || !!note || undefined}>
    <summary>
      <span className="status__label">{label}</span>
      <strong className="status__value status-compact__value">{value}</strong>
      <span className="status__rating" data-color={color} style={{ color: `var(--${color}-text)` }}>{zone ? zoneTitle(zone) : t('common.noData')}</span>
      <DisclosureChevron size={16} />
    </summary>
    <div className="status-compact__body">
      <div className="status__scale"><ZoneBar zone={zone} thresholds={thresholds} inverse={inverse} unit={unit} /></div>
      <div className="status__notes">
        {rows?.map(r => <StatRow key={r.label} label={r.label} value={r.value} />)}
        {advice && <p className="status__advice">{advice}</p>}
        {note && <p className="status__advice">{note}</p>}
        {link && <Link to={link.to} className="link-accent status__link">{link.label}</Link>}
        {promptKey && <CopyPromptButton metric={promptKey} />}
      </div>
    </div>
  </details>
}
